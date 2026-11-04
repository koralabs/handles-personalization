import cbor from "cbor";

// cbor@9 `cbor.encode()` reads the Encoder stream once, and on Node 26 that returns only the first chunk
// (a 1-byte buffer for any tagged/nested value). Drain the stream instead.
export const encodeCbor = (value, options) => {
  const encoder = new cbor.Encoder(options);
  encoder.pushAny(value);
  encoder.end();
  const chunks = [];
  for (let chunk = encoder.read(); chunk !== null; chunk = encoder.read()) chunks.push(chunk);
  return Buffer.concat(chunks);
};
