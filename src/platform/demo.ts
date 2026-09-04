/* A small project to open on first run, so the app is never a blank grey box.
 *
 * It is built by the real scaffolder and then given three pages and a beat, so
 * what you see here is exactly what a genuine project looks like. */

import { scaffoldProject } from '../core/scaffold.ts';

const pages: Record<string, string> = {
    'entities/character/igor.md': `---
id: igor
type: character
name: Igor
status: complete
role: Odd neighbour who becomes a vendor
home: "[[cutters-hollow]]"
---

Turns up on your land uninvited, gives you an axe, points at your only tree,
and is delighted when it dies.
`,

    'entities/item/wooden-axe.md': `---
id: wooden-axe
type: item
name: Wooden Axe
status: in-progress
value: 12
components: []
---

The first tool the player owns. Blunt, heavy, slow.
`,

    'entities/location/cutters-hollow.md': `---
id: cutters-hollow
type: location
name: Cutters Hollow
status: pending
access: Reachable on foot once Igor has pointed the way.
connects_to: []
---

Dark pines and older graves.
`,

    'entities/location/feckl-fjord.md': `---
id: feckl-fjord
type: location
name: Feckl Fjord
status: complete
access: Through the wrought iron gates at the head of the valley.
connects_to: []
---

A town that does not know your name and is in no hurry to learn it.
`,

    'progression/act-1.md': `---
id: act_1
type: act
name: Act I
beats:
  - id: beat_01_01
    title: The wrought iron gates
    status: complete
    verify: flag entered_gates is set and the player is in the village
    opens: ["[[feckl-fjord]]"]
    text: Fog parts as the player steps through the gates.
  - id: beat_01_03
    title: Igor turns up uninvited
    status: pending
    verify: "flag igor_met is set and [[wooden-axe]] is in the player's inventory"
    requires: { all: [{ done: beat_01_01 }] }
    introduces: ["[[igor]]"]
    grants: [{ item: "[[wooden-axe]]", from: "[[igor]]", how: gift }]
    opens: ["[[cutters-hollow]]"]
    text: Igor arrives on the player's land and hands over an axe.
---

The valley opens up, and the first neighbour arrives.
`,
};

export const DEMO_FILES: Record<string, string> = (() => {
    const out: Record<string, string> = {};
    for (const file of scaffoldProject('Demo')) out[file.path] = file.text;
    // The scaffold ships an empty act; the demo replaces it with a real one.
    return { ...out, ...pages };
})();
