// "bakery": a working bakery interior with a brick oven, bench, shelves and a sales counter.
// params: era = old | 1839;  items = kipferl | croissant | bread;  action = idle | knead | peel | serve | listen;
//         customers = 0..3;  who = towns | paris
// cams: main (room), oven, table, counter; hero / heroOven (wide lens, close, 3/4, foreground: the default look)
import * as THREE from "three";
import { mat, gloss, glow, fireMat, flicker, mesh, box, cyl, woodTex, brickTex, checkTex, frame, drift, smooth, lerp, charCam, heroCam, lowCam, highCam, povCam, pathCam } from "../core/stage";
import { pastry, loaf, steam } from "./food";
import { Person, Who, cast } from "./people";
import { plasterTex, stoneFloorTex, sack, copperPan, rollingPin, breadBasket, lightShaft, wainscot, timberFrame, logStack, kneadingTrough, wallPeel, hangingBasket, flourBowl, flourDust, barrel, rug, herbBundles, specks } from "./dressing";
import type { CamState, Ctx, SceneDef, V3 } from "../core/types";

export const bakeryScene: SceneDef = {
  id: "bakery",
  build() {
    const root = new THREE.Group();
    const wood = mat("#ffffff", { map: woodTex("bk", "#9a6f48", "#5f3d22") }), dark = mat("#6a4a30"), brick = mat("#ffffff", { map: brickTex("bk", ["#b0614a", "#9c5440", "#bb6d52", "#a65a45"], "#d8c7b0") });
    // real-material world (VISUAL_DENSITY core elements): stone slab floor, lime-plaster walls (clean painted textures)
    const floorT = stoneFloorTex("bkstone"); floorT.repeat.set(4.5, 8);
    root.add(mesh(new THREE.PlaneGeometry(9, 16).rotateX(-Math.PI / 2), mat("#ffffff", { map: floorT, key: "bkstone" }), [0, 0, 5], false));
    const plaster = plasterTex("bkplaster"), wallOld = mat("#cfb994", { map: plaster, key: "bkplaster-old" }), wallNew = mat("#e2d1b0", { map: plaster, key: "bkplaster-new" });
    void checkTex;
    const backWall = box(9, 6.4, 0.2, wallOld, [0, 0, -2.1]), leftWall = box(0.2, 6.4, 16, wallOld, [-3.6, 0, 5]), rightWall = box(0.2, 6.4, 16, wallOld, [3.6, 0, 5]);
    const beams = new THREE.Group(); root.add(beams); for (const z of [-1.2, 0.6, 2.4]) beams.add(box(7.4, 0.24, 0.24, dark, [0, 3.5, z])); // ceiling beams (hidden for overhead cameras)
    root.add(backWall, leftWall, rightWall);
    const win = mesh(new THREE.PlaneGeometry(1.5, 1.3).rotateY(Math.PI / 2), glow("#fff1cf", 1.7), [-3.48, 1.9, -0.2], false); root.add(win);
    for (const z of [-0.95, -0.2, 0.55]) root.add(box(0.06, 1.4, 0.07, dark, [-3.46, 1.2, z])); root.add(box(0.06, 0.07, 1.6, dark, [-3.46, 1.86, -0.2]));
    // oven: brick body, dark mouth with a live fire glow, hood + chimney
    const oven = new THREE.Group(); oven.position.set(1.9, 0, -1.45); root.add(oven);
    oven.add(box(2.0, 0.75, 1.1, brick), box(0.55, 0.7, 1.1, brick, [-0.725, 0.75, 0]), box(0.55, 0.7, 1.1, brick, [0.725, 0.75, 0]), box(2.0, 0.55, 1.1, brick, [0, 1.45, 0]), box(0.9, 0.7, 0.9, mat("#2a1d18"), [0, 0.75, -0.08]));
    oven.add(box(1.3, 0.9, 0.9, brick, [0, 2.0, -0.05]), box(0.6, 0.6, 0.6, brick, [0, 2.9, -0.2]));
    const fire = mesh(new THREE.PlaneGeometry(0.84, 0.62), fireMat(), [0, 1.1, 0.38], false); oven.add(fire);
    const ovenFloor = box(0.9, 0.03, 0.7, mat("#4a3a34"), [0, 0.75, 0.1]); oven.add(ovenFloor);
    // bench with dough, a tray of the product, flour sacks
    const bench = new THREE.Group(); bench.position.set(-1.0, 0, -0.55); root.add(bench);
    bench.add(box(1.9, 0.07, 0.85, wood, [0, 0.83, 0])); for (const [x, z] of [[-0.85, -0.35], [0.85, -0.35], [-0.85, 0.35], [0.85, 0.35]]) bench.add(box(0.09, 0.83, 0.09, dark, [x, 0, z]));
    const doughBall = mesh(new THREE.SphereGeometry(0.13, 24, 16), mat("#f1dfb6"), [-0.25, 0.98, -0.25]); bench.add(doughBall); // right under the baker's hands
    const trayG = new THREE.Group(); trayG.position.set(0.35, 0.9, 0.05); bench.add(trayG); trayG.add(box(0.72, 0.012, 0.46, gloss("#3d3d45", 50, "#999")));
    const sets: Record<string, THREE.Group> = { kipferl: new THREE.Group(), croissant: new THREE.Group(), bread: new THREE.Group() };
    for (let i = 0; i < 6; i++) { const p: V3 = [-0.22 + (i % 3) * 0.22, 0.014, -0.1 + Math.floor(i / 3) * 0.21];
      sets.kipferl.add(pastry({ kind: "kipferl", len: 0.16 }, p, 0.2 * (i % 2 ? 1 : -1))); sets.croissant.add(pastry({ len: 0.16 }, p, 0.2 * (i % 2 ? 1 : -1))); if (i < 4) sets.bread.add(loaf(i % 2 ? "round" : "long", [-0.2 + (i % 2) * 0.4, 0.014, -0.1 + Math.floor(i / 2) * 0.22], i)); }
    Object.values(sets).forEach((g) => trayG.add(g));
    // flour sacks with a stamped generic word, copper pans on the back wall, a rolling pin on the bench, a basket of loaves
    for (const [x, z, s, ry] of [[-3.0, -1.5, 1.15, 0.4], [-2.55, -1.7, 1.0, -0.3], [-3.05, -0.9, 1.05, 1.2]]) root.add(sack([x, 0, z], s, ry));
    for (const [x, y, r] of [[0.12, 2.25, 0.13], [0.48, 2.2, 0.16], [0.86, 2.27, 0.11]]) root.add(copperPan([x, y, -1.99], r));
    bench.add(rollingPin([-0.62, 0.87, 0.22], 0.35));
    root.add(breadBasket([1.55, 0, 1.55], 0.26, 2));
    // the window's sun as a soft beam into the room (an effect layer: not baked, not exported to Blender)
    root.add(lightShaft([-3.42, 2.35, -0.2], [-0.7, 0, 0.8], 1.25, "#ffe3b8", 0.14));
    // a lived-in workshop: wood wainscot, exposed timber framing, a window sill, firewood for the oven, a kneading
    // trough under the window, peels on the side wall, baskets hanging from the beam, a bowl of flour, flour on the floor
    root.add(wainscot("x", -3.5, 0.95, -2.0, 1), wainscot("z", -2.0, 0.95, -3.5, 1));
    root.add(timberFrame([-3.3, -0.2], -2.0, 0.95, 3.32, [-3.1, 2.55, -0.45, 3.22]));
    root.add(box(0.26, 0.05, 1.7, dark, [-3.38, 1.2, -0.2]));
    root.add(logStack([3.2, 0, -1.3], 5, 3, 0.55));
    root.add(kneadingTrough([-3.1, 0, -0.2], 1.25, 0.5));
    root.add(wallPeel(-3.5, -1.45, 2.75, 1), wallPeel(-3.5, -1.72, 2.6, 1, 1.4));
    beams.add(hangingBasket(-2.0, -1.2, 3.38, 0.5, 4), hangingBasket(3.0, -1.2, 3.38, 0.62, 7));
    bench.add(flourBowl([0.82, 0.87, -0.28]));
    // accent colours (FEEDBACK_LOG #14): a striped runner by the oven, herbs and onions on the beams; flour motes in the
    // window beam and sparks at the oven mouth keep the air alive
    root.add(rug([0.55, 0, 0.15], 1.05, 2.3, 0.45));
    beams.add(herbBundles(-0.5, 0.6, 3.5, 4, 0.3), herbBundles(1.9, 0.6, 3.5, 3, 0.34));
    const motes = specks(44, [2.4, 2.2, 1.6], { s: 0.016 }); motes.grp.position.set(-2.1, 0.3, 0.35); root.add(motes.grp);
    const sparks = specks(16, [0.55, 1.0, 0.15], { color: "#ffb15c", s: 0.028, glow: true }); sparks.grp.position.set(1.9, 1.15, -0.9); root.add(sparks.grp);
    // a cloth-covered barrel with a blue jug beside the oven (red and blue accents)
    root.add(barrel([3.0, 0, 0.25], 0.95, 0.32, { cloth: "#b8352c", jug: "#2f6fb0" }));
    // foreground for the hero cameras: flour sacks and a basket in the lower-left corner just in front of the lens (shown
    // only while a hero camera stands next to them, so they never block the other set-ups)
    const fg = new THREE.Group(); root.add(fg);
    fg.add(sack([-0.22, 0, 1.62], 1.1, 0.3), sack([0.12, 0, 1.78], 0.85, -0.6, "SEL"), breadBasket([-0.42, 0, 1.98], 0.22, 5));
    root.add(flourDust([-1.05, 0, -0.25], 0.55, 1), flourDust([-0.35, 0, 0.15], 0.32, 2), flourDust([1.6, 0, -0.55], 0.35, 3));
    // shelves with bread on the back wall
    for (const y of [1.25, 1.75, 2.25]) { root.add(box(2.6, 0.05, 0.36, wood, [-1.6, y, -1.85])); for (let i = 0; i < 6; i++) root.add(loaf(i % 3 === 0 ? "long" : i % 3 === 1 ? "round" : "roll", [-2.65 + i * 0.42, y + 0.05, -1.84], i * 0.9 + y)); }
    // lantern (old) / hanging lamp (1839)
    const lantern = new THREE.Group(); lantern.position.set(-0.2, 2.5, -0.3); root.add(lantern); lantern.add(cyl(0.01, 0.01, 0.8, dark, [0, 0.1, 0]), box(0.2, 0.26, 0.2, dark, [0, -0.2, 0]), mesh(new THREE.BoxGeometry(0.15, 0.18, 0.15), glow("#ffd27a", 2.4), [0, -0.07, 0], false));
    // sales counter (front left) with a glass case in 1839
    const counter = new THREE.Group(); counter.position.set(-1.9, 0, 1.25); root.add(counter);
    counter.add(box(2.4, 0.95, 0.6, wood), box(2.5, 0.05, 0.7, dark, [0, 0.95, 0]));
    const glass = mesh(new THREE.BoxGeometry(1.2, 0.34, 0.5), gloss("#cfe6ee", 120, "#ffffff", { transparent: true, opacity: 0.28 }), [0.5, 1.17, 0], false); counter.add(glass);
    const display: Record<string, THREE.Group> = { kipferl: new THREE.Group(), croissant: new THREE.Group(), bread: new THREE.Group() };
    for (let i = 0; i < 5; i++) { display.kipferl.add(pastry({ kind: "kipferl", len: 0.2, r: 0.027 }, [0.05 + i * 0.22, 1.0, 0.02], 0.3)); display.croissant.add(pastry({ len: 0.2, r: 0.036 }, [0.05 + i * 0.22, 1.0, 0.02], 0.3)); if (i < 3) display.bread.add(loaf("round", [0.15 + i * 0.36, 1.0, 0], i)); }
    Object.values(display).forEach((g) => counter.add(g));
    const basket = cyl(0.2, 0.15, 0.16, mat("#b98a52"), [-0.75, 1.0, 0]); counter.add(basket);
    // peel carrying two pastries into the oven
    const peel = new THREE.Group(); root.add(peel); peel.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.7, 10).rotateZ(Math.PI / 2), wood, [-0.85, 0, 0]), box(0.5, 0.02, 0.36, wood, [0.22, -0.01, 0]));
    const peelK = [pastry({ kind: "kipferl", len: 0.17 }, [0.12, 0.012, 0], 0.3), pastry({ kind: "kipferl", len: 0.17 }, [0.33, 0.012, 0.02], -0.2)], peelC = [pastry({ len: 0.17 }, [0.12, 0.012, 0], 0.3), pastry({ len: 0.17 }, [0.33, 0.012, 0.02], -0.2)];
    peel.add(...peelK, ...peelC);
    const st = steam(6, 0.5, 0.12); st.grp.position.set(-0.65, 0.95, -0.5); root.add(st.grp);
    const baker = new Person(root, "baker", 1), helper = new Person(root, "apprentice", 2);
    const cust = [0, 1, 2].map((i) => ({ towns: new Person(root, "towns", i + 3), paris: new Person(root, "paris", i + 3) }));
    const people = [baker, helper, ...cust.flatMap((x) => [x.towns, x.paris])]; let charsOn = true;

    const cam = (centre: V3, dir: V3, w: number, h: number, fov = 34, cInf = 8) => (c: Ctx): CamState => drift(frame(centre, w, h, dir, c.aspect, fov, 1.08, cInf), c.u, 0.06, 0.03);
    // set-ups that the story cameras below reuse as keys
    const camWideL = charCam([-0.3, 1.4, -0.6], 6.0, 2.9, { yaw: 22, pitch: 6, fov: 36, cInf: 4, portrait: [[-0.5, 1.7, -0.7], 3.8, 3.6], pyaw: 9 });
    const camTable = charCam([-0.85, 1.15, -0.6], 2.3, 1.45, { yaw: 12, pitch: 8, cInf: 9 });
    const camHeroOven = heroCam([0.8, 1.25, -0.65], 2.2, 1.7, { yaw: -14, pitch: -3, fov: 52, portrait: [[0.8, 1.25, -0.65], 1.9, 2.0] });
    return {
      root, light: "interior", actors: () => cast(people, charsOn),
      // Character cameras (charCam): eye level, no roll, audience side. Inserts (cam): free angles, cast hidden.
      cams: {
        main: charCam([-0.1, 1.35, -0.6], 6.2, 2.9, { yaw: 4, pitch: 7, fov: 36, cInf: 4, portrait: [[-0.1, 1.75, -0.8], 3.9, 3.6] }),
        wideL: camWideL,
        wideR: charCam([0.1, 1.4, -0.4], 6.2, 2.9, { yaw: -20, pitch: 6, fov: 36, cInf: 4, portrait: [[-0.6, 1.6, 0.4], 3.9, 3.4], pyaw: -9 }),
        table: camTable,
        two: charCam([-0.78, 1.2, -1.2], 1.9, 1.5, { yaw: -6, pitch: 3, cInf: 10 }),
        counter: charCam([-0.75, 1.2, 1.0], 4.4, 2.0, { yaw: 12, pitch: 5, fov: 32, cInf: 9, portrait: [[-0.75, 1.2, 1.0], 3.1, 2.2], pyaw: 8 }),
        oven: charCam([1.1, 1.15, -0.9], 3.0, 1.9, { yaw: -12, pitch: 5, cInf: 9, portrait: [[1.05, 1.15, -0.9], 2.7, 2.2] }),
        baker: charCam([-1.25, 1.36, -1.2], 0.95, 1.0, { yaw: 9, pitch: 1, fov: 26, cInf: 12, push: 0.03 }),
        helper: charCam([-0.3, 1.0, -1.2], 0.9, 0.9, { yaw: -9, pitch: 2, fov: 26, cInf: 12, push: 0.03 }),
        // hero: low and close from the front, a little to the left: bench and shelves recede on the left, the baker in
        // the middle, the oven fire glows at the right edge, beams and herbs overhead; flour sacks hold the lower-left
        // corner in front of the lens for the whole push-in
        hero: heroCam([0.6, 1.3, -0.6], 2.6, 1.9, { yaw: -12, pitch: -4, portrait: [[0.6, 1.3, -0.6], 2.4, 2.0] }),
        heroOven: camHeroOven,
        // story cameras (FEEDBACK_LOG #17): low hero angles on the work, a high reveal of the room, the baker's own view of
        // the oven (his card is hidden because the lens sits at his eyes), one glide across the room through three set-ups
        lowBaker: lowCam([-1.25, 1.35, -1.2], 1.4, 1.7, { yaw: 10, portrait: [[-1.25, 1.35, -1.2], 1.3, 1.9] }),
        lowOven: lowCam([0.7, 1.35, -0.5], 2.0, 1.8, { yaw: -16, portrait: [[0.7, 1.35, -0.5], 1.8, 2.0] }),
        highRoom: highCam([-0.5, 1.0, -0.4], 4.2, 2.6, { yaw: 8, portrait: [[-0.5, 1.0, -0.4], 3.2, 3.0] }),
        povBaker: povCam([0.45, 1.5, 0.15], [1.85, 0.9, -1.25]), // use with action "peel": the baker stands at [0.45, 0, -0.1]
        sweep: pathCam([camWideL, camTable, camHeroOven]),
        tray: cam([-0.65, 0.93, -0.5], [0.1, 1, 0.75], 0.95, 0.6, 28, 12),
        ovenMouth: cam([1.9, 1.02, -0.95], [-0.12, 0.16, 1], 1.15, 0.8, 28, 10),
        shelf: cam([-1.6, 1.75, -1.85], [0.3, 0.06, 1], 2.9, 1.4, 28, 10),
        high: cam([-0.3, 0.9, -0.4], [0.12, 1, 0.55], 6.2, 4.2, 36, 3),
      },
      shots: { main: { kind: "wide", chars: true }, wideL: { kind: "wide", chars: true }, wideR: { kind: "wide", chars: true }, table: { kind: "medium", chars: true }, two: { kind: "medium", chars: true },
        counter: { kind: "medium", chars: true }, hero: { kind: "medium", chars: true }, heroOven: { kind: "medium", chars: true }, oven: { kind: "medium", chars: true }, baker: { kind: "closeup", chars: true }, helper: { kind: "closeup", chars: true },
        lowBaker: { kind: "medium", chars: true, drama: true }, lowOven: { kind: "medium", chars: true, drama: true }, highRoom: { kind: "wide", chars: true, drama: true },
        povBaker: { kind: "medium", chars: true }, sweep: { kind: "medium", chars: true },
        tray: { kind: "detail", chars: false }, ovenMouth: { kind: "food", chars: false }, shelf: { kind: "food", chars: false }, high: { kind: "top", chars: false } },
      update(c: Ctx, cm: CamState) {
        const p = c.params as { era?: string; items?: string; action?: string; customers?: number; who?: Who }, era = p.era ?? "1839", items = p.items ?? "kipferl", action = p.action ?? "idle";
        const wall = era === "old" ? wallOld : wallNew; [backWall, leftWall, rightWall].forEach((w) => { w.material = wall; });
        glass.visible = era !== "old"; lantern.visible = true; beams.visible = cm.pos[1] < 3.2;
        for (const [k, g] of Object.entries(sets)) g.visible = k === items; for (const [k, g] of Object.entries(display)) g.visible = k === items;
        flicker(fire.material as THREE.Material, c.f); motes.set(c.f); sparks.set(c.f);
        fg.visible = Math.hypot(cm.pos[0] + 0.17, cm.pos[2] - 3.2) < 1.0;
        // knead: the dough is pressed and released
        const kn = action === "knead" ? 0.5 + 0.5 * Math.sin(c.t * 5) : 0.25; doughBall.scale.set(1 + 0.25 * kn, 0.75 - 0.3 * kn, 1 + 0.15 * kn); doughBall.position.y = 0.87 + 0.13 * (0.75 - 0.3 * kn);
        // Every working character uses their hands (Person `hands`: [metres right of the body, metres up]); nobody
        // slides across the floor in the front drawing: the baker stands still and the WORK moves.
        // peel: the baker stands by the oven and slides the long peel through both hands into the mouth and partly back
        const k = action === "peel" ? smooth(c.p / 0.55) - smooth((c.p - 0.75) / 0.25) * 0.6 : 0; peel.visible = action === "peel";
        peelK.forEach((m) => { m.visible = items !== "croissant"; }); peelC.forEach((m) => { m.visible = items === "croissant"; });
        st.set(c.f, items === "bread" ? 0.3 : 0.5);
        const listen = action === "listen", w = c.t * 5;
        if (action === "peel") {
          const push = 0.06 * k, hands: [[number, number], [number, number]] = [[0.1 + push, 0.98], [0.34 + push, 0.94]];
          baker.pose(c.f, [0.45, 0, -0.1], cm.pos, { expr: "smile_closed", hands });
          const g = baker.handWorld([(hands[0][0] + hands[1][0]) / 2, (hands[0][1] + hands[1][1]) / 2]), T = new THREE.Vector3(1.85, 0.84, -1.25), G = new THREE.Vector3(...g);
          const dir = T.clone().sub(G).normalize(), L = lerp(0.85, 1.6, k);   // blade root distance in front of the grip
          peel.position.copy(G.clone().addScaledVector(dir, L)); peel.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
        } else if (action === "serve") {
          // hands a roll over the glass case (held above it, so it reads): the right hand lifts it out to the customers, the left rests on the counter
          const r = 0.5 + 0.5 * Math.sin(c.t * 2.4);
          baker.pose(c.f, [-1.75, 0, 0.72], cm.pos, { expr: "smile", look: 1, hands: [[-0.2, 1.02], [lerp(0.26, 0.46, r), lerp(1.3, 1.46, r)]], hold: items === "croissant" ? "croissant" : "kipferl" });
        } else if (action === "knead") {
          // both palms press the dough down and out, in time with the squash of the dough ball below
          const kn = 0.5 + 0.5 * Math.sin(w);
          baker.pose(c.f, [-1.25, 0, -1.2], cm.pos, { expr: "neutral", hands: [[-0.1 - 0.03 * kn, 1.0 - 0.07 * kn], [0.1 + 0.03 * kn, 1.0 - 0.07 * kn]] });
        } else if (listen) {
          // the news: hands fly up to the cheeks and tremble
          const tr = 0.01 * Math.sin(c.t * 18);
          baker.pose(c.f, [-1.25, 0, -1.2], cm.pos, { expr: "shock", look: 1, hands: [[-0.3 + tr, 1.3], [0.3 - tr, 1.3]] });
        } else baker.pose(c.f, [-1.25, 0, -1.2], cm.pos, { expr: "smile_closed", hands: [[-0.12, 1.0], null] });
        // the apprentice lays rolls on the tray (left hand dips to the tray and back); nervous with clasped hands when listening
        const lay = Math.max(0, Math.sin(c.t * 2.2));
        if (action === "serve" || action === "peel") helper.pose(c.f, [-0.55, 0, -1.25], cm.pos, { expr: "neutral", hands: [[-0.26 - 0.04 * lay, 0.86 - 0.05 * lay], null] });
        else helper.pose(c.f, [-0.3, 0, -1.2], cm.pos, listen ? { expr: "nervous", hands: [[-0.04, 0.62], [0.04, 0.62]] } : { expr: "smile", hands: [[-0.28 - 0.05 * lay, 0.88 - 0.05 * lay], null] });
        const n = p.customers ?? (action === "serve" ? 2 : 0), who = p.who ?? "paris";
        cust.forEach((cu, i) => { const on = i < n; (who === "paris" ? cu.towns : cu.paris).hide(); const P = who === "paris" ? cu.paris : cu.towns; if (on) P.pose(c.f, [-0.15 + i * 0.85, 0, 1.25 + (i % 2) * 0.3], cm.pos, { expr: i % 2 ? "smile" : "grin", look: -1 }); else P.hide(); });
        // a tight shot aimed at the back of the room from in front of the sales counter would look THROUGH the counter
        // and its glass case (a blurred block over the subject): the counter is struck from the set for those shots
        const tight = Math.hypot(cm.pos[0] - cm.look[0], cm.pos[2] - cm.look[2]) < 6.5;
        counter.visible = !(tight && cm.look[2] < 0.2 && cm.pos[2] > 1.0 && cm.look[0] < 0.2);
        // point-of-view shots put the lens at someone's eyes: that person leaves the picture
        people.forEach((x) => { const m = x.card.mesh; if (m.visible && Math.hypot(m.position.x - cm.pos[0], m.position.z - cm.pos[2]) < 0.45) x.hide(); });
        charsOn = c.chars; if (!c.chars) people.forEach((x) => x.hide());
      },
    };
  },
};
