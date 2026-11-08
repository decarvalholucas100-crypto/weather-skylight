// Generates the high-resolution cloud noise volume off the main thread so startup stays instant.
import { generateCloudNoise } from './noise';

self.onmessage = (e: MessageEvent<number>) => {
  const data = generateCloudNoise(e.data);
  (self as unknown as Worker).postMessage(data, [data.buffer]);
};
