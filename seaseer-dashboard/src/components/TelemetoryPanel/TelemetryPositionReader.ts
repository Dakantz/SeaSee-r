export interface PositionSample {
    relativeTime: number;
    x: number;
    y: number;
    z: number;
    direction?: [number, number, number];
    rotation?: [number, number, number, number];
    filename?: string;
    id?: string;
    cameraHeaderId?: string;
}

export interface PositionSamplePair {
    previous: PositionSample;
    next: PositionSample;
}

interface RawPositionFeature {
    type: "Feature";

    properties: {
        relative_time: number;
        translation: [number, number, number];
        direction?: [number, number, number];
    };

    geometry: {
        type: "Point";
        coordinates: [number, number, number];
    };
}

interface RawPositionGeoJSON {
    type: "FeatureCollection";
    features: RawPositionFeature[];
}

export class TelemetryPositionReader {
    private url: string;

    private samples: PositionSample[] | null = null;

    private nextIndex = -1;

    constructor(url: string) {
        this.url = url;
    }

    private async loadPositionData(): Promise<PositionSample[]> {
        const response = await fetch(this.url);

        if (!response.ok) {
            throw new Error(
                `Failed to load position data: ${response.status} ${response.statusText}`
            );
        }

        const data = await response.json();

        // Handle direct CameraFrameResponse[] from database API endpoint
        if (Array.isArray(data)) {
            return data
                .filter((item: any) => item.position && Array.isArray(item.position) && item.position.length === 3)
                .map((item: any) => ({
                    relativeTime: item.relative_time ?? item.timestamp ?? 0,
                    x: item.position[0],
                    y: item.position[1],
                    z: item.position[2],
                    direction: item.direction && Array.isArray(item.direction) && item.direction.length === 3
                        ? item.direction
                        : undefined,
                    rotation: item.rotation && Array.isArray(item.rotation) && item.rotation.length === 4
                        ? item.rotation
                        : undefined,
                    filename: item.filename,
                    id: item.id,
                    cameraHeaderId: item.camera_header_id,
                }));
        }

        // Handle GeoJSON FeatureCollection format
        if (data && Array.isArray(data.features)) {
            return (data as RawPositionGeoJSON).features.map((feature) => {
                const [x, y, z] = feature.properties.translation;
                const dir = feature.properties.direction;
                return {
                    relativeTime: feature.properties.relative_time,
                    x,
                    y,
                    z,
                    direction: Array.isArray(dir) && dir.length === 3 ? dir : undefined,
                };
            });
        }

        return [];
    }

    async getPositionData(): Promise<PositionSample[]> {
        if (!this.samples) {
            this.samples = await this.loadPositionData();
        }

        return this.samples;
    }

    // Find the position sample pair surrounding the startTime.
    async getInitialPair(
        startTime: number = 0
    ): Promise<PositionSamplePair | null> {
        const samples =
            await this.getPositionData();
        this.nextIndex = -1;

        if (samples.length < 2) {
            return null;
        }

        for (
            this.nextIndex = 1;
            this.nextIndex < samples.length;
            this.nextIndex++
        ) {
            if (
                samples[this.nextIndex]
                    .relativeTime > startTime
            ) {
                return {
                    previous:
                        samples[
                            this.nextIndex - 1
                        ],
                    next:
                        samples[
                            this.nextIndex
                        ],
                };
            }
        }

        return null;
    }

    // Advance the active position pair by one sample.
    async getNextPair():
        Promise<PositionSamplePair | null> {
        const samples =
            await this.getPositionData();

        if (this.nextIndex < 0) {
            return null;
        }

        if (this.nextIndex + 1 >= samples.length) {
            return null;
        }

        this.nextIndex++;

        return {
            previous:
                samples[this.nextIndex - 1],
            next:
                samples[this.nextIndex],
        };
    }

    reset(): void {
        this.nextIndex = -1;
    }

    getUrl(): string {
        return this.url;
    }
}