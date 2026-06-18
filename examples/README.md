# PPO PyTorch Example

`ppo_pytorch.py` is a minimal PPO implementation for validating an RL training
pipeline.

It includes:

- PyTorch actor-critic network
- GAE advantage estimation
- clipped surrogate policy loss
- entropy bonus
- synchronous vector-env rollout structure
- training logs for reward, policy loss, value loss, entropy, and explained variance

Run a quick smoke test:

```powershell
python examples/ppo_pytorch.py --total-timesteps 512 --num-envs 2 --num-steps 64
```

Install `gymnasium` to train on CartPole:

```powershell
pip install gymnasium[classic-control]
python examples/ppo_pytorch.py --env-id CartPole-v1 --total-timesteps 10000
```

When Gym/Gymnasium is not installed, the script automatically uses a tiny
built-in Gym-like balancing environment so the PPO code path still runs.
