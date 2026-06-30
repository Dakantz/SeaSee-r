import torch

def test_gpu_acceleration():
    print("Testing PyTorch GPU Acceleration...")
    
    # Check if CUDA is available
    cuda_available = torch.cuda.is_available()
    print(f"CUDA Available: {cuda_available}")
    
    if cuda_available:
        # Get the number of GPUs
        num_gpus = torch.cuda.device_count()
        print(f"Number of GPUs: {num_gpus}")
        
        # Get the name of the active GPU device
        device_name = torch.cuda.get_device_name(0)
        print(f"Active GPU Device Name: {device_name}")
        
        # Additional info
        current_device = torch.cuda.current_device()
        print(f"Current Device ID: {current_device}")
    else:
        print("CUDA is NOT available. PyTorch will use the CPU.")

if __name__ == "__main__":
    test_gpu_acceleration()
