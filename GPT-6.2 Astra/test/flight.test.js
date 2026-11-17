import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene, Vector3 } from 'three';
import { Materials } from '../src/materials.js';
import { Bee } from '../src/model/rig.js';
import { FlightController } from '../src/flight.js';
import { PLINTH_TOP } from '../src/stage.js';

function flyAndLand(frameRate) {
  const bee = new Bee(new Scene(), new Materials(null));
  const flight = new FlightController(bee);
  const point = new Vector3();
  const dt = 1 / frameRate;

  function advance(spread = 0) {
    bee.explode(spread);
    flight.update(dt, dt, spread);
    bee.root.updateMatrixWorld(true);
    return bee.legs.map((leg) => {
      const heel = leg.sole.getWorldPosition(point).y;
      const toe = leg.foot.getWorldPosition(point).y;
      const clearance = Math.min(heel, toe) - PLINTH_TOP;
      assert.ok(clearance >= -0.001, 'A tarsus passed through the plinth');
      return clearance;
    });
  }

  flight.toggle();
  for (let frame = 0; frame < 7 * frameRate; frame++) {
    const feet = advance();
    if (frame <= 4 * frameRate) continue;
    for (const side of [0, 3]) {
      assert.ok(feet[side + 2] < Math.min(feet[side], feet[side + 1]), 'Hind leg tucked too high');
    }
  }
  const hoverPosition = flight.pos.clone();
  flight.toggle();
  let touched = false;
  for (let frame = 0; frame < 4 * frameRate; frame++) {
    if (Math.min(...advance()) < 0.018 && !touched) {
      assert.ok(flight.open > 0.8, 'Wings folded before contact');
      touched = true;
    }
  }
  assert.ok(touched);
  assert.equal(flight.state, 'RESTING');
  for (let percent = 0; percent <= 100; percent++) advance(percent / 100);
  return hoverPosition;
}

test('Leg suspension supports landing and disassembly at 30, 60 and 120 fps', () => {
  const reference = flyAndLand(60);
  for (const frameRate of [30, 120]) {
    assert.ok(flyAndLand(frameRate).distanceTo(reference) < 0.001, 'Steering changed with frame rate');
  }
});
