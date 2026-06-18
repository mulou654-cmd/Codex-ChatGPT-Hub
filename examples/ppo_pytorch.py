"""Minimal PyTorch PPO example with GAE and a vector-env friendly rollout loop.

Run:
    python examples/ppo_pytorch.py --total-timesteps 4096

If gymnasium/gym is installed, the script trains on CartPole-v1. Otherwise it
uses a small built-in Gym-like balancing environment so the PPO pipeline can be
verified without extra dependencies.
"""

from __future__ import annotations

import argparse
import random
from collections import deque
from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Sequence

import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Categorical


try:
    import gymnasium as gym
except ImportError:  # pragma: no cover - exercised only when gymnasium exists.
    try:
        import gym  # type: ignore[no-redef]
    except ImportError:  # pragma: no cover - fallback env covers this path.
        gym = None


class SimpleBalanceEnv:
    """Tiny discrete-control environment used when Gym is unavailable.

    The state is [position, velocity]. Actions push left/right. Episodes end
    when the position leaves bounds or max steps is reached.
    """

    observation_shape = (2,)
    action_n = 2

    def __init__(self, seed: Optional[int] = None, max_steps: int = 200) -> None:
        self.rng = np.random.default_rng(seed)
        self.max_steps = max_steps
        self.position = 0.0
        self.velocity = 0.0
        self.steps = 0

    def reset(self, seed: Optional[int] = None):
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        self.position = float(self.rng.uniform(-0.05, 0.05))
        self.velocity = float(self.rng.uniform(-0.02, 0.02))
        self.steps = 0
        return np.array([self.position, self.velocity], dtype=np.float32), {}

    def step(self, action: int):
        force = -0.08 if int(action) == 0 else 0.08
        self.velocity = 0.94 * self.velocity + force + float(self.rng.normal(0.0, 0.01))
        self.position += self.velocity
        self.steps += 1

        terminated = abs(self.position) > 2.4
        truncated = self.steps >= self.max_steps
        reward = 1.0 - 0.2 * abs(self.position)
        if terminated:
            reward = -1.0
        return (
            np.array([self.position, self.velocity], dtype=np.float32),
            float(reward),
            bool(terminated),
            bool(truncated),
            {},
        )


class EnvAdapter:
    """Normalizes Gym/Gymnasium reset and step signatures."""

    def __init__(self, env) -> None:
        self.env = env
        if hasattr(env, "single_observation_space"):
            self.obs_shape = tuple(env.single_observation_space.shape)
            self.action_n = int(env.single_action_space.n)
        elif hasattr(env, "observation_space"):
            self.obs_shape = tuple(env.observation_space.shape)
            self.action_n = int(env.action_space.n)
        else:
            self.obs_shape = tuple(env.observation_shape)
            self.action_n = int(env.action_n)

    def reset(self, seed: Optional[int] = None) -> np.ndarray:
        try:
            result = self.env.reset(seed=seed)
        except TypeError:
            if seed is not None and hasattr(self.env, "seed"):
                self.env.seed(seed)
            result = self.env.reset()
        obs = result[0] if isinstance(result, tuple) else result
        return np.asarray(obs, dtype=np.float32)

    def step(self, action: int):
        result = self.env.step(int(action))
        if len(result) == 5:
            obs, reward, terminated, truncated, info = result
            done = bool(terminated or truncated)
        else:
            obs, reward, done, info = result
        return np.asarray(obs, dtype=np.float32), float(reward), bool(done), info


class SyncVectorEnv:
    """Simple synchronous vector environment shaped for future parallelization."""

    def __init__(self, env_fns: Sequence[Callable[[], EnvAdapter]]) -> None:
        self.envs = [fn() for fn in env_fns]
        self.num_envs = len(self.envs)
        self.obs_shape = self.envs[0].obs_shape
        self.action_n = self.envs[0].action_n
        self.episode_returns = np.zeros(self.num_envs, dtype=np.float32)
        self.episode_lengths = np.zeros(self.num_envs, dtype=np.int32)

    def reset(self, seed: int) -> np.ndarray:
        observations = []
        for idx, env in enumerate(self.envs):
            observations.append(env.reset(seed + idx))
        self.episode_returns.fill(0.0)
        self.episode_lengths.fill(0)
        return np.stack(observations)

    def step(self, actions: Iterable[int]):
        next_obs, rewards, dones, infos = [], [], [], []
        for idx, (env, action) in enumerate(zip(self.envs, actions)):
            obs, reward, done, info = env.step(int(action))
            self.episode_returns[idx] += reward
            self.episode_lengths[idx] += 1
            if done:
                info = {
                    **info,
                    "episode": {
                        "reward": float(self.episode_returns[idx]),
                        "length": int(self.episode_lengths[idx]),
                    },
                }
                obs = env.reset()
                self.episode_returns[idx] = 0.0
                self.episode_lengths[idx] = 0
            next_obs.append(obs)
            rewards.append(reward)
            dones.append(done)
            infos.append(info)
        return (
            np.stack(next_obs),
            np.asarray(rewards, dtype=np.float32),
            np.asarray(dones, dtype=np.float32),
            infos,
        )


class ActorCritic(nn.Module):
    def __init__(self, obs_dim: int, action_dim: int, hidden_dim: int = 64) -> None:
        super().__init__()
        self.backbone = nn.Sequential(
            nn.Linear(obs_dim, hidden_dim),
            nn.Tanh(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.Tanh(),
        )
        self.actor = nn.Linear(hidden_dim, action_dim)
        self.critic = nn.Linear(hidden_dim, 1)

    def forward(self, obs: torch.Tensor):
        features = self.backbone(obs)
        return self.actor(features), self.critic(features).squeeze(-1)

    def get_action_and_value(self, obs: torch.Tensor, action: Optional[torch.Tensor] = None):
        logits, value = self(obs)
        dist = Categorical(logits=logits)
        if action is None:
            action = dist.sample()
        return action, dist.log_prob(action), dist.entropy(), value


@dataclass
class PPOConfig:
    env_id: str = "CartPole-v1"
    seed: int = 7
    total_timesteps: int = 10_000
    num_envs: int = 4
    num_steps: int = 128
    learning_rate: float = 2.5e-4
    gamma: float = 0.99
    gae_lambda: float = 0.95
    update_epochs: int = 4
    minibatch_size: int = 256
    clip_coef: float = 0.2
    ent_coef: float = 0.01
    vf_coef: float = 0.5
    max_grad_norm: float = 0.5
    hidden_dim: int = 64
    device: str = "cpu"


def make_env(env_id: str, seed: int, rank: int) -> Callable[[], EnvAdapter]:
    def thunk() -> EnvAdapter:
        if gym is None:
            return EnvAdapter(SimpleBalanceEnv(seed=seed + rank))
        env = gym.make(env_id)
        return EnvAdapter(env)

    return thunk


def compute_gae(
    rewards: torch.Tensor,
    dones: torch.Tensor,
    values: torch.Tensor,
    next_value: torch.Tensor,
    next_done: torch.Tensor,
    gamma: float,
    gae_lambda: float,
):
    advantages = torch.zeros_like(rewards)
    last_gae_lam = torch.zeros(rewards.shape[1], device=rewards.device)
    for t in reversed(range(rewards.shape[0])):
        if t == rewards.shape[0] - 1:
            next_non_terminal = 1.0 - next_done
            next_values = next_value
        else:
            next_non_terminal = 1.0 - dones[t + 1]
            next_values = values[t + 1]
        delta = rewards[t] + gamma * next_values * next_non_terminal - values[t]
        last_gae_lam = delta + gamma * gae_lambda * next_non_terminal * last_gae_lam
        advantages[t] = last_gae_lam
    returns = advantages + values
    return advantages, returns


def train(config: PPOConfig) -> None:
    random.seed(config.seed)
    np.random.seed(config.seed)
    torch.manual_seed(config.seed)
    device = torch.device(config.device)

    envs = SyncVectorEnv([make_env(config.env_id, config.seed, i) for i in range(config.num_envs)])
    obs_dim = int(np.prod(envs.obs_shape))
    agent = ActorCritic(obs_dim, envs.action_n, config.hidden_dim).to(device)
    optimizer = torch.optim.Adam(agent.parameters(), lr=config.learning_rate, eps=1e-5)

    obs = torch.tensor(envs.reset(config.seed), dtype=torch.float32, device=device).view(config.num_envs, -1)
    next_done = torch.zeros(config.num_envs, dtype=torch.float32, device=device)
    episode_rewards: deque[float] = deque(maxlen=20)
    global_step = 0
    num_updates = max(1, config.total_timesteps // (config.num_envs * config.num_steps))

    print(
        f"training env={'SimpleBalanceEnv' if gym is None else config.env_id} "
        f"updates={num_updates} steps/update={config.num_steps} envs={config.num_envs}"
    )

    for update in range(1, num_updates + 1):
        obs_buf = torch.zeros((config.num_steps, config.num_envs, obs_dim), device=device)
        actions_buf = torch.zeros((config.num_steps, config.num_envs), dtype=torch.long, device=device)
        logprobs_buf = torch.zeros((config.num_steps, config.num_envs), device=device)
        rewards_buf = torch.zeros((config.num_steps, config.num_envs), device=device)
        dones_buf = torch.zeros((config.num_steps, config.num_envs), device=device)
        values_buf = torch.zeros((config.num_steps, config.num_envs), device=device)

        for step in range(config.num_steps):
            global_step += config.num_envs
            obs_buf[step] = obs
            dones_buf[step] = next_done

            with torch.no_grad():
                action, logprob, _, value = agent.get_action_and_value(obs)
            actions_buf[step] = action
            logprobs_buf[step] = logprob
            values_buf[step] = value

            next_obs_np, reward_np, done_np, infos = envs.step(action.cpu().numpy())
            for info in infos:
                if "episode" in info:
                    episode_rewards.append(float(info["episode"]["reward"]))
            rewards_buf[step] = torch.tensor(reward_np, dtype=torch.float32, device=device)
            next_done = torch.tensor(done_np, dtype=torch.float32, device=device)
            obs = torch.tensor(next_obs_np, dtype=torch.float32, device=device).view(config.num_envs, -1)

        with torch.no_grad():
            next_value = agent.get_action_and_value(obs)[3]
            advantages, returns = compute_gae(
                rewards_buf,
                dones_buf,
                values_buf,
                next_value,
                next_done,
                config.gamma,
                config.gae_lambda,
            )

        batch_obs = obs_buf.reshape((-1, obs_dim))
        batch_logprobs = logprobs_buf.reshape(-1)
        batch_actions = actions_buf.reshape(-1)
        batch_advantages = advantages.reshape(-1)
        batch_returns = returns.reshape(-1)
        batch_values = values_buf.reshape(-1)
        batch_size = config.num_envs * config.num_steps
        minibatch_size = min(config.minibatch_size, batch_size)

        last_policy_loss = 0.0
        last_value_loss = 0.0
        last_entropy = 0.0
        for _ in range(config.update_epochs):
            indices = torch.randperm(batch_size, device=device)
            for start in range(0, batch_size, minibatch_size):
                mb_idx = indices[start : start + minibatch_size]
                _, new_logprob, entropy, new_value = agent.get_action_and_value(
                    batch_obs[mb_idx], batch_actions[mb_idx]
                )
                log_ratio = new_logprob - batch_logprobs[mb_idx]
                ratio = log_ratio.exp()

                mb_advantages = batch_advantages[mb_idx]
                mb_advantages = (mb_advantages - mb_advantages.mean()) / (mb_advantages.std() + 1e-8)
                unclipped = -mb_advantages * ratio
                clipped = -mb_advantages * torch.clamp(
                    ratio, 1.0 - config.clip_coef, 1.0 + config.clip_coef
                )
                policy_loss = torch.max(unclipped, clipped).mean()
                value_loss = 0.5 * (new_value - batch_returns[mb_idx]).pow(2).mean()
                entropy_loss = entropy.mean()
                loss = policy_loss + config.vf_coef * value_loss - config.ent_coef * entropy_loss

                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(agent.parameters(), config.max_grad_norm)
                optimizer.step()

                last_policy_loss = float(policy_loss.detach().cpu())
                last_value_loss = float(value_loss.detach().cpu())
                last_entropy = float(entropy_loss.detach().cpu())

        mean_reward = float(np.mean(episode_rewards)) if episode_rewards else float("nan")
        explained_var = explained_variance(batch_values.detach(), batch_returns.detach())
        print(
            f"update={update:03d} step={global_step:06d} "
            f"reward_mean={mean_reward:8.3f} policy_loss={last_policy_loss:8.4f} "
            f"value_loss={last_value_loss:8.4f} entropy={last_entropy:7.4f} "
            f"explained_var={explained_var:7.3f}"
        )


def explained_variance(values: torch.Tensor, returns: torch.Tensor) -> float:
    y_true = returns.cpu().numpy()
    y_pred = values.cpu().numpy()
    variance = np.var(y_true)
    if variance == 0:
        return float("nan")
    return float(1.0 - np.var(y_true - y_pred) / variance)


def parse_args() -> PPOConfig:
    parser = argparse.ArgumentParser(description="Train a minimal PyTorch PPO agent.")
    parser.add_argument("--env-id", default=PPOConfig.env_id)
    parser.add_argument("--seed", type=int, default=PPOConfig.seed)
    parser.add_argument("--total-timesteps", type=int, default=PPOConfig.total_timesteps)
    parser.add_argument("--num-envs", type=int, default=PPOConfig.num_envs)
    parser.add_argument("--num-steps", type=int, default=PPOConfig.num_steps)
    parser.add_argument("--learning-rate", type=float, default=PPOConfig.learning_rate)
    parser.add_argument("--gamma", type=float, default=PPOConfig.gamma)
    parser.add_argument("--gae-lambda", type=float, default=PPOConfig.gae_lambda)
    parser.add_argument("--update-epochs", type=int, default=PPOConfig.update_epochs)
    parser.add_argument("--minibatch-size", type=int, default=PPOConfig.minibatch_size)
    parser.add_argument("--clip-coef", type=float, default=PPOConfig.clip_coef)
    parser.add_argument("--ent-coef", type=float, default=PPOConfig.ent_coef)
    parser.add_argument("--vf-coef", type=float, default=PPOConfig.vf_coef)
    parser.add_argument("--max-grad-norm", type=float, default=PPOConfig.max_grad_norm)
    parser.add_argument("--hidden-dim", type=int, default=PPOConfig.hidden_dim)
    parser.add_argument("--device", default=PPOConfig.device)
    return PPOConfig(**vars(parser.parse_args()))


if __name__ == "__main__":
    train(parse_args())
