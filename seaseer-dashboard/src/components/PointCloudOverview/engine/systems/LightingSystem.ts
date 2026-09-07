import * as THREE from "three";
import type { EngineConfig } from "../types";

export const TARGET_X = 0;
export const TARGET_Y = 0;

export class LightingSystem {
    private group: THREE.Group;
    private ambientLight: THREE.AmbientLight;
    private hemisphereLight: THREE.HemisphereLight;
    private keyLight: THREE.DirectionalLight;
    private fillLight: THREE.DirectionalLight;
    private targetObject: THREE.Object3D;

    constructor(scene: THREE.Scene, config: Partial<EngineConfig> = {}) {
        this.group = new THREE.Group();
        this.group.name = "LightingSystemGroup";

        const ambientIntensity = config.ambientLightIntensity ?? 0.6;
        const hemiIntensity = config.hemisphereLightIntensity ?? 0.5;
        const keyIntensity = config.keyLightIntensity ?? 1.0;
        const fillIntensity = config.fillLightIntensity ?? 0.4;

        // Target object
        this.targetObject = new THREE.Object3D();
        this.targetObject.position.set(TARGET_X, TARGET_Y, 0);
        this.group.add(this.targetObject);

        // Ambient Light
        this.ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
        this.group.add(this.ambientLight);

        // Hemisphere Light (sky #ffffff, ground #334455)
        this.hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x334455, hemiIntensity);
        this.hemisphereLight.position.set(TARGET_X, TARGET_Y, 10000);
        this.group.add(this.hemisphereLight);

        // Directional Key Light (NW)
        this.keyLight = new THREE.DirectionalLight(0xffffff, keyIntensity);
        this.keyLight.position.set(TARGET_X - 5000, TARGET_Y + 5000, 8000);
        this.keyLight.target = this.targetObject;
        this.group.add(this.keyLight);

        // Directional Fill Light (SE)
        this.fillLight = new THREE.DirectionalLight(0xcce0ff, fillIntensity);
        this.fillLight.position.set(TARGET_X + 5000, TARGET_Y - 5000, 4000);
        this.fillLight.target = this.targetObject;
        this.group.add(this.fillLight);

        scene.add(this.group);
    }

    public updateConfig(config: Partial<EngineConfig>): void {
        if (config.ambientLightIntensity !== undefined) {
            this.ambientLight.intensity = config.ambientLightIntensity;
        }
        if (config.hemisphereLightIntensity !== undefined) {
            this.hemisphereLight.intensity = config.hemisphereLightIntensity;
        }
        if (config.keyLightIntensity !== undefined) {
            this.keyLight.intensity = config.keyLightIntensity;
        }
        if (config.fillLightIntensity !== undefined) {
            this.fillLight.intensity = config.fillLightIntensity;
        }
    }

    public destroy(scene: THREE.Scene): void {
        scene.remove(this.group);
        this.ambientLight.dispose();
        this.hemisphereLight.dispose();
        this.keyLight.dispose();
        this.fillLight.dispose();
        this.group.clear();
    }
}
