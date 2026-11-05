import assert from "node:assert/strict";
import { test } from "node:test";
import { engineNet, HAND_NET } from "./figures";

test("the printed figure on /welcome matches the pencil figure", () => {
  assert.equal(engineNet(), HAND_NET);
});
