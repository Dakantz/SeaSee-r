import { useState, useRef, useCallback } from 'react';

export const useDragAndDrop = (onFilesAdded: (files: File[]) => void, disabled: boolean = false) => {
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;

    if (e.type === "dragenter") {
      dragCounter.current += 1;
      setDragActive(true);
    } else if (e.type === "dragleave") {
      dragCounter.current -= 1;
      if (dragCounter.current === 0) {
        setDragActive(false);
      }
    } else if (e.type === "dragover") {
      setDragActive(true);
    }
  }, [disabled]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragActive(false);
    if (disabled) return;

    if (e.dataTransfer.items) {
      const newFiles: File[] = [];
      const traverseFileTree = async (item: any, path: string = '') => {
        return new Promise<void>((resolve) => {
          if (item.isFile) {
            item.file((file: File) => {
              newFiles.push(file);
              resolve();
            });
          } else if (item.isDirectory) {
            const dirReader = item.createReader();
            dirReader.readEntries(async (entries: any[]) => {
              const promises = entries.map(entry => traverseFileTree(entry, path + item.name + "/"));
              await Promise.all(promises);
              resolve();
            });
          } else {
            resolve();
          }
        });
      };

      const promises = [];
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i].webkitGetAsEntry();
        if (item) promises.push(traverseFileTree(item));
      }
      await Promise.all(promises);
      if (newFiles.length > 0) {
        onFilesAdded(newFiles);
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesAdded(Array.from(e.dataTransfer.files));
    }
  }, [disabled, onFilesAdded]);

  return { dragActive, handleDrag, handleDrop };
};
