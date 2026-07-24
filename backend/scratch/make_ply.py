import random
with open('/home/gsoc-thomas/Documents/GsoC/SeaSee-r/backend/scratch/large.ply', 'w') as f:
    f.write("ply\nformat ascii 1.0\nelement vertex 100000\nproperty float x\nproperty float y\nproperty float z\nend_header\n")
    for _ in range(100000):
        f.write(f"{random.random()} {random.random()} {random.random()}\n")
