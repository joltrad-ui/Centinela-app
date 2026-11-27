import test from "node:test";
import assert from "node:assert/strict";
import { usaPuente, viaPuente } from "../scanner/puente.mjs";

const base = "https://puente.ejemplo.workers.dev/?k=abc&url=";
const cboe = "https://cdn.cboe.com/api/global/delayed_quotes/options/SPY.json";

test("sin puente, la dirección de CBOE no cambia", () => {
  assert.equal(viaPuente(cboe, ""), cboe);
  assert.equal(viaPuente(cboe, undefined), cboe);
  assert.equal(usaPuente(""), false);
});

test("con puente, CBOE pasa por él con la dirección codificada", () => {
  assert.equal(viaPuente(cboe, base), base + encodeURIComponent(cboe));
  assert.equal(usaPuente(base), true);
});

test("el puente solo se usa para CBOE y solo si es https", () => {
  const otra = "https://stockanalysis.com/api/symbol/s/aapl/earnings";
  assert.equal(viaPuente(otra, base), otra);
  assert.equal(viaPuente(cboe, "http://inseguro/?url="), cboe);
});
