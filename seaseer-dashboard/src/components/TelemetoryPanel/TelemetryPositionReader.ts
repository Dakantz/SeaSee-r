export interface PositionSample {
    relativeTime: number;
    x: number;
    y: number;
    z: number;
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

        const data =
            (await response.json()) as RawPositionGeoJSON;

        return data.features.map((feature) => {
            const [x, y, z] =
                feature.properties.translation;

            return {
                relativeTime:
                    feature.properties.relative_time,
                x,
                y,
                z,
            };
        });
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