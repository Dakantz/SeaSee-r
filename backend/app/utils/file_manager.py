import os
import shutil

class FileManager:
    @staticmethod
    def move_file(src: str, dest_dir: str, safe_filename: str) -> str:
        """
        Moves a file from `src` to `dest_dir` with the new filename `safe_filename`.
        Creates `dest_dir` if it does not exist.
        """
        if not os.path.exists(src):
            raise FileNotFoundError(f"Source file {src} does not exist.")
            
        os.makedirs(dest_dir, exist_ok=True)
        dest_path = os.path.join(dest_dir, safe_filename)
        shutil.move(src, dest_path)
        return dest_path
        
    @staticmethod
    def copy_file(src: str, dest_dir: str, safe_filename: str) -> str:
        """
        Copies a file from `src` to `dest_dir` with the new filename `safe_filename`.
        Creates `dest_dir` if it does not exist.
        """
        if not os.path.exists(src):
            raise FileNotFoundError(f"Source file {src} does not exist.")
            
        os.makedirs(dest_dir, exist_ok=True)
        dest_path = os.path.join(dest_dir, safe_filename)
        shutil.copy(src, dest_path)
        return dest_path

    @staticmethod
    def remove_file(filepath: str):
        """
        Removes a file if it exists.
        """
        if os.path.exists(filepath):
            os.remove(filepath)
