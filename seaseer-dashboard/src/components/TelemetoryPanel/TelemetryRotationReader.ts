export interface AttitudeSample {
    relativeTime: number;
    yaw: number;
    pitch: number;
    roll: number;
}

export interface AttitudeSamplePair {
    previous: AttitudeSample;
    next: AttitudeSample;
}

interface RawTelemetryEntry {
    type: string;
    relative_time: number;
    payload: Record<string, unknown>;
}

export class TelemetryAttitudeReader {
    private url: string;

    private iterator:
        AsyncGenerator<AttitudeSample> | null = null;

    private previousSample:
        AttitudeSample | null = null;

    private nextSample:
        AttitudeSample | null = null;

    constructor(url: string) {
        this.url = url;
    }

    // Stream attitude samples from the telemetry JSON file.
    async *streamAttitudeData():
        AsyncGenerator<AttitudeSample> {
        const response = await fetch(this.url);

        if (!response.ok) {
            throw new Error(
                `Failed to load telemetry: ${response.statusText}`
            );
        }

        if (!response.body) {
            throw new Error(
                "Streaming response body is not available"
            );
        }

        const reader = response.body
            .pipeThrough(new TextDecoderStream())
            .getReader();

        let objectBuffer = "";
        let depth = 0;

        let insideString = false;
        let escaped = false;

        while (true) {
            const { value, done } =
                await reader.read();

            if (done) {
                break;
            }

            for (const char of value) {
                // Ignore everything outside JSON objects.
                if (depth === 0) {
                    if (char === "{") {
                        depth = 1;
                        objectBuffer = "{";

                        insideString = false;
                        escaped = false;
                    }

                    continue;
                }

                objectBuffer += char;

                // Handle characters inside JSON strings.
                if (insideString) {
                    if (escaped) {
                        escaped = false;
                    } else if (char === "\\") {
                        escaped = true;
                    } else if (char === '"') {
                        insideString = false;
                    }

                    continue;
                }

                if (char === '"') {
                    insideString = true;
                    continue;
                }

                // Handle nested objects such as payload.
                if (char === "{") {
                    depth++;
                    continue;
                }

                if (char === "}") {
                    depth--;

                    if (depth === 0) {
                        try {
                            const entry =
                                JSON.parse(
                                    objectBuffer
                                ) as RawTelemetryEntry;

                            if (
                                entry.type ===
                                "attitude"
                            ) {
                                yield {
                                    relativeTime:
                                        entry.relative_time,

                                    yaw:
                                        entry.payload
                                            .yaw as number,

                                    pitch:
                                        entry.payload
                                            .pitch as number,

                                    roll:
                                        entry.payload
                                            .roll as number,
                                };
                            }
                        } catch (error) {
                            console.error(
                                "Failed to parse telemetry object:",
                                objectBuffer,
                                error
                            );
                        }

                        objectBuffer = "";
                    }
                }
            }
        }
    }

    // Find the telemetry sample pair surrounding the startTime.
    async getInitialPair(
        startTime: number = 0
    ): Promise<AttitudeSamplePair | null> {
        // Initialize or reset iterator to stream telemetry from the start.
        this.iterator =
            this.streamAttitudeData();

        this.previousSample = null;
        this.nextSample = null;

        const first =
            await this.iterator.next();

        if (first.done) {
            return null;
        }

        this.previousSample =
            first.value;

        while (true) {
            const result =
                await this.iterator.next();

            // Return null if EOF is reached or only one sample exists.
            if (result.done) {
                return null;
            }

            this.nextSample =
                result.value;

            // Check if we found the pair containing startTime.
            if (
                this.nextSample.relativeTime >
                startTime
            ) {
                return {
                    previous:
                        this.previousSample,

                    next:
                        this.nextSample,
                };
            }

            // Move previous sample forward.
            this.previousSample =
                this.nextSample;
        }
    }

    // Advance the active stream by exactly one attitude sample.
    async getNextPair():
        Promise<AttitudeSamplePair | null> {
        if (
            !this.iterator ||
            !this.previousSample ||
            !this.nextSample
        ) {
            return null;
        }

        const result =
            await this.iterator.next();

        if (result.done) {
            return null;
        }

        this.previousSample =
            this.nextSample;

        this.nextSample =
            result.value;

        return {
            previous:
                this.previousSample,

            next:
                this.nextSample,
        };
    }

    // Invalidate the current telemetry stream immediately.
    reset(): void {
        this.iterator = null;
        this.previousSample = null;
        this.nextSample = null;
    }

    getUrl(): string {
        return this.url;
    }
}