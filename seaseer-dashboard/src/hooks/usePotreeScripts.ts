import { useEffect, useState } from 'react';
import * as THREE from 'three';

const CSS_FILES = [
    '/potree/build/potree/potree.css',
    '/potree/libs/jquery-ui/jquery-ui.min.css',
    '/potree/libs/openlayers3/ol.css',
    '/potree/libs/spectrum/spectrum.css',
    '/potree/libs/jstree/themes/mixed/style.css',
];

const JS_FILES = [
    '/potree/libs/jquery/jquery-3.1.1.min.js',
    '/potree/libs/spectrum/spectrum.js',
    '/potree/libs/jquery-ui/jquery-ui.min.js',
    '/potree/libs/other/BinaryHeap.js',
    '/potree/libs/tween/tween.min.js',
    '/potree/libs/d3/d3.js',
    '/potree/libs/proj4/proj4.js',
    '/potree/libs/openlayers3/ol.js',
    '/potree/libs/i18next/i18next.js',
    '/potree/libs/jstree/jstree.js',
    '/potree/libs/copc/index.js',
    '/potree/build/potree/potree.js',
    '/potree/libs/plasio/js/laslaz.js',
];

export const usePotreeScripts = () => {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        // Expose THREE globally for Potree to use
        (window as any).THREE = THREE;

        let isCancelled = false;
        
        // Helper to load CSS sequentially/parallel
        const loadCSS = (href: string) => {
            return new Promise<void>((resolve, reject) => {
                if (document.querySelector(`link[href="${href}"]`)) {
                    resolve();
                    return;
                }
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = href;
                link.onload = () => resolve();
                link.onerror = () => reject(new Error(`Failed to load CSS: ${href}`));
                document.head.appendChild(link);
            });
        };

        // Helper to load JS sequentially (important because potree.js depends on jquery etc.)
        const loadJS = (src: string) => {
            return new Promise<void>((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) {
                    resolve();
                    return;
                }
                const script = document.createElement('script');
                script.src = src;
                script.async = false; // Keep execution order
                script.onload = () => resolve();
                script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
                document.body.appendChild(script);
            });
        };

        const loadAll = async () => {
            try {
                // Load all CSS in parallel
                await Promise.all(CSS_FILES.map(loadCSS));
                
                // Load JS sequentially to preserve dependency order
                for (const src of JS_FILES) {
                    await loadJS(src);
                }
                
                if (!isCancelled) {
                    setLoaded(true);
                }
            } catch (err) {
                if (!isCancelled) {
                    setError(err as Error);
                }
            }
        };

        loadAll();

        return () => {
            isCancelled = true;
        };
    }, []);

    return { loaded, error };
};
