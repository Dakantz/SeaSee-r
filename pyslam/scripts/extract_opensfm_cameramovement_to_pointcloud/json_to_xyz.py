import sys
import json
import os
import asyncio
import numpy as np

def rotvec_to_matrix(r):
    r = np.array(r, dtype=float)
    theta = np.linalg.norm(r)
    if theta < 1e-8:
        return np.eye(3)
    k = r / theta
    K = np.array([
        [0, -k[2], k[1]],
        [k[2], 0, -k[0]],
        [-k[1], k[0], 0]
    ])
    R = np.eye(3) + np.sin(theta) * K + (1 - np.cos(theta)) * np.dot(K, K)
    return R

def get_camera_center(rotation, translation):
    R = rotvec_to_matrix(rotation)
    t = np.array(translation, dtype=float)
    center = -np.dot(R.T, t)
    return center

async def run_entwine(file_path, output_dir):
    print(f"--- Running entwine for {file_path} -> {output_dir} ---")
    # Run entwine as a subprocess with progress logging
    process = await asyncio.create_subprocess_exec(
        'entwine', 'build', '-i', file_path, '-o', output_dir, '--scale', '0.001', '--progress', '1',
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    
    # Read standard output to show progress
    while True:
        line = await process.stdout.readline()
        if not line:
            break
        print(line.decode().rstrip())

    await process.wait()
    if process.returncode != 0:
        err = await process.stderr.read()
        print(f"Entwine failed with code {process.returncode}:\n{err.decode()}")
    else:
        print(f"Entwine finished successfully for {file_path}.")

async def main():
    if len(sys.argv) < 3:
        print("Usage: python json_to_xyz.py <input_reconstruction.json> <output_pointcloud.csv>")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    # 1. Load the JSON file
    with open(input_file, "r") as f:
        reconstructions = json.load(f)
        if isinstance(reconstructions, dict):
            print(f"Error: The provided JSON '{input_file}' is a dictionary.")
            print("It looks like you provided the OpenSfM 'reports/reconstruction.json' file instead of the main 'reconstruction.json' which contains the points.")
            sys.exit(1)

    base_name, ext = os.path.splitext(output_file)

    # 2. Loop through all reconstructions
    for idx, data in enumerate(reconstructions):
        # If there are multiple reconstructions, append the index (e.g., pointcloud_0.csv)
        current_out_file = output_file if len(reconstructions) == 1 else f"{base_name}_{idx}{ext}"
        
        with open(current_out_file, "w") as out_f:
            # Write a standard header that PDAL/Entwine understands natively
            out_f.write("X,Y,Z,Red,Green,Blue\n")
            
            # 3. Loop through shots and write camera centers as X,Y,Z (colored Red)
            shots = data.get("shots", {})
            if not shots:
                print(f"Warning: No 'shots' found in reconstruction {idx}.")
                
            for shot_id, sdata in shots.items():
                if "rotation" not in sdata or "translation" not in sdata:
                    continue
                
                rotation = sdata["rotation"]
                translation = sdata["translation"]
                
                center = get_camera_center(rotation, translation)
                x, y, z = center[0], center[1], center[2]
                
                # Give camera positions a distinct color, e.g., pure red
                r, g, b = 255, 0, 0
                
                # Write comma-separated values
                out_f.write(f"{x},{y},{z},{int(r)},{int(g)},{int(b)}\n")

        print(f"Conversion of reconstruction {idx} to {current_out_file} complete!")

        # 4. Automatically call entwine
        entwine_output_dir = f"{base_name}_{idx}_entwine" if len(reconstructions) > 1 else f"{base_name}_entwine"
        await run_entwine(current_out_file, entwine_output_dir)

if __name__ == "__main__":
    asyncio.run(main())
