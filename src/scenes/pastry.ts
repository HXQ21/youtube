// "pastry": the dish as the hero. A plated pastry on a table with a soft, blurred setting behind it.
// params: item = croissant | kipferl | cut | pair | sandwich | pile;  backdrop = cafe | bakery | palace | plain | diner;  steam = 0..1
//         wallTex = "assetId/name" of an image texture (asset kind "texture", e.g. made with Dreamina): shown as the wall behind the plate
// cams: main (3/4 hero), macro (surface / layers), top, low, wide.  action "crunch": the cut pastry opens and flakes fall.
import * as THREE from "three";
import { noChars, mat, gloss, glow, mesh, box, woodTex, checkTex, frame, drift, smooth, actionT } from "../core/stage";
import { pastry, cutPastry, plate, cup, loaf, croissantSandwich, flakes, steam } from "./food";
import type { CamState, Ctx, SceneDef, V3 } from "../core/types";

export const pastryScene: SceneDef = {
  id: "pastry",
  build(env) {
    const root = new THREE.Group();
    // ---- table tops (one per backdrop family)
    const tops: Record<string, THREE.Object3D> = {
      wood: mesh(new THREE.BoxGeometry(2.4, 0.04, 1.3), mat("#ffffff", { map: woodTex("table", "#8f6a4c", "#6a4a32") }), [0, -0.02, 0]),
      marble: mesh(new THREE.BoxGeometry(2.4, 0.04, 1.3), gloss("#efe9e2", 80, "#aaaaaa"), [0, -0.02, 0]),
      paper: mesh(new THREE.BoxGeometry(6, 0.04, 6), mat("#efe2c8"), [0, -0.02, 0]),
      steel: mesh(new THREE.BoxGeometry(2.4, 0.04, 1.3), gloss("#c9d1d8", 90, "#ffffff"), [0, -0.02, 0]),
    };
    Object.values(tops).forEach((t) => root.add(t));
    // ---- backdrops, 1.1-1.6 m behind the plate so the lens blur turns them into soft shapes
    const back: Record<string, THREE.Group> = {};
    const mk = (k: string) => { const g = new THREE.Group(); back[k] = g; root.add(g); return g; };
    { const g = mk("cafe"); // warm wall, a bright window, a chair back
      g.add(box(5, 2.6, 0.1, mat("#d8b48a"), [0, -0.8, -1.5]), mesh(new THREE.PlaneGeometry(1.1, 1.3), glow("#fff3d6", 1.5), [-0.75, 0.75, -1.44], false));
      for (const x of [-1.32, -0.75, -0.18]) g.add(box(0.05, 1.4, 0.06, mat("#7a5232"), [x, 0.05, -1.42]));
      g.add(box(1.25, 0.05, 0.08, mat("#7a5232"), [-0.75, 0.73, -1.42]), box(0.46, 0.5, 0.05, mat("#8a4f34"), [0.75, -0.12, -0.9]), box(1.5, 0.05, 0.3, mat("#6d4424"), [0.9, 0.55, -1.4]));
      g.add(loaf("round", [0.6, 0.6, -1.38]), loaf("long", [1.1, 0.6, -1.36], 0.3)); }
    { const g = mk("bakery"); // shelves of bread
      g.add(box(5, 2.6, 0.1, mat("#c9a27a"), [0, -0.8, -1.5]));
      for (const y of [0.22, 0.62, 1.0]) { g.add(box(3.2, 0.04, 0.32, mat("#7a5232"), [0, y, -1.34])); for (let i = 0; i < 7; i++) g.add(loaf(i % 3 === 0 ? "long" : i % 3 === 1 ? "round" : "roll", [-1.35 + i * 0.45, y + 0.04, -1.32 + (i % 2) * 0.04], i * 0.7)); } }
    { const g = mk("palace"); // pale panelled wall with gilded mouldings and a blue drape: a setting, not a portrait of anyone
      g.add(box(5, 2.8, 0.1, mat("#e9e2cf"), [0, -0.8, -1.6]));
      for (const x of [-1.5, -0.5, 0.5, 1.5]) { g.add(box(0.8, 0.03, 0.03, mat("#c9a23a"), [x, 1.15, -1.54]), box(0.8, 0.03, 0.03, mat("#c9a23a"), [x, 0.12, -1.54]), box(0.03, 1.06, 0.03, mat("#c9a23a"), [x - 0.4, 0.12, -1.54]), box(0.03, 1.06, 0.03, mat("#c9a23a"), [x + 0.4, 0.12, -1.54])); }
      const drape = mesh(new THREE.CylinderGeometry(0.28, 0.4, 2.4, 12, 1, true, 0, Math.PI), mat("#3f5f9a", { side: THREE.DoubleSide }), [1.9, 0.5, -1.45]); g.add(drape);
      g.add(mesh(new THREE.PlaneGeometry(6, 4).rotateX(-Math.PI / 2), mat("#ffffff", { map: checkTex("palace", "#d9d2c2", "#8a8272", 12) }), [0, -0.85, -0.5], false)); }
    { const g = mk("diner"); // 1980s counter: tiled wall, napkin box, a tray
      g.add(box(5, 2.6, 0.1, mat("#ffffff", { map: checkTex("diner", "#f2efe6", "#e24a3a", 16) }), [0, -0.8, -1.3]), box(0.14, 0.12, 0.1, gloss("#c9d1d8", 90, "#ffffff"), [0.55, 0, -0.3]), box(3, 0.5, 0.12, mat("#f0b429"), [0, 0.95, -1.24])); }
    mk("plain");
    // image backdrop: a painted wall made with Dreamina (asset kind "texture"), params.wallTex = "assetId/name"
    const imgWall = mesh(new THREE.PlaneGeometry(5, 2.8), mat("#ffffff", { key: "pastry-imgwall" }), [0, 0.5, -1.5], false); root.add(imgWall); // own material: its map is swapped per shot
    // ---- hero items
    const spin = new THREE.Group(); root.add(spin);
    const dish = plate(0.13); spin.add(dish);
    const lift = 0.009;
    const items: Record<string, THREE.Object3D> = {};
    items.croissant = pastry({}, [0, lift, -0.015], 0.25);
    items.kipferl = pastry({ kind: "kipferl" }, [0, lift, -0.02], 0.2);
    const cut = cutPastry("croissant"); cut.grp.position.set(0, lift, -0.015); cut.grp.rotation.y = 0.2; items.cut = cut.grp;
    const cutK = cutPastry("kipferl"); cutK.grp.position.set(0, lift, -0.02); cutK.grp.rotation.y = 0.2; items.cutk = cutK.grp;
    { const g = new THREE.Group(); g.add(pastry({ kind: "kipferl" }, [-0.062, lift, 0.01], 0.5), pastry({ len: 0.15, r: 0.028 }, [0.058, lift, -0.02], -0.3)); items.pair = g; }
    items.sandwich = croissantSandwich([0, lift, 0]);
    { const g = new THREE.Group(); const P: [number, number, number, number][] = [[-0.05, 0, 0.02, 0.4], [0.05, 0, 0.03, -0.5], [0, 0, -0.05, 1.3], [-0.02, 0.045, 0.01, 2.2], [0.04, 0.043, -0.02, 0.9]];
      P.forEach(([x, y, z, r]) => g.add(pastry({ len: 0.13, r: 0.025 }, [x, lift + y, z], r))); items.pile = g; }
    Object.values(items).forEach((o) => spin.add(o));
    const fl = flakes(46, 0.11, 7); fl.inst.position.y = lift; spin.add(fl.inst);
    const st = steam(7, 0.17, 0.04); st.grp.position.set(0, 0.06, -0.01); root.add(st.grp);
    const mug = cup([0.27, 0, -0.1]); root.add(mug);
    const mugSteam = steam(5, 0.12, 0.025); mugSteam.grp.position.set(0.27, 0.07, -0.1); root.add(mugSteam.grp);
    const napkin = mesh(new THREE.BoxGeometry(0.15, 0.003, 0.15), mat("#f4efe2"), [-0.27, 0.0015, 0.06]); napkin.rotation.y = 0.35; root.add(napkin);

    const centre: V3 = [0, 0.055, 0];
    const cam = (dir: V3, w: number, h: number, fov: number, cInf: number, k = 0.07) => (c: Ctx): CamState => drift(frame(centre, w, h, dir, c.aspect, fov, 1.15, cInf), c.u, k, 0.04);
    return {
      root, light: "table", shots: noChars({ main: "food", macro: "food", low: "food", side: "food", back: "food", heroUp: "food", dutch: "food", wide: "wide", top: "top", orbit: "top" }),
      cams: {
        main: cam([0.42, 0.3, 1], 0.27, 0.2, 30, 15),
        macro: cam([0.25, 0.4, 1], 0.16, 0.1, 26, 20, 0.1),
        top: cam([0, 1, 0.14], 0.32, 0.3, 30, 4, 0.05),
        low: cam([0.2, 0.16, 1], 0.3, 0.16, 28, 18),
        wide: cam([0.5, 0.42, 1], 0.56, 0.3, 34, 10, 0.05),
        side: cam([1, 0.2, 0.3], 0.26, 0.16, 28, 16),
        back: cam([-0.55, 0.36, 1], 0.28, 0.18, 30, 15),
        heroUp: cam([0.22, 0.13, 1], 0.2, 0.14, 32, 14, 0.09),
        dutch: (c) => ({ ...cam([0.35, 0.34, 1], 0.24, 0.18, 30, 16, 0.1)(c), roll: 0.16 }),
        orbit: (c) => { const a = -0.7 + 1.4 * smooth(c.u); return frame(centre, 0.27, 0.19, [Math.sin(a), 0.36, Math.cos(a)], c.aspect, 30, 1.15, 15); },
      },
      update(c: Ctx) {
        const p = c.params as { item?: string; backdrop?: string; steam?: number; cup?: boolean }, item = p.item ?? "croissant", bd = p.backdrop ?? "cafe";
        for (const [k, o] of Object.entries(items)) o.visible = k === item;
        const wall = typeof (c.params as { wallTex?: string }).wallTex === "string" ? env.tex((c.params as { wallTex: string }).wallTex) : null;
        for (const [k, g] of Object.entries(back)) g.visible = k === bd && !wall; // an image wall replaces the painted backdrop; the table top still follows `backdrop`
        imgWall.visible = !!wall; if (wall) { const m = imgWall.material as THREE.MeshLambertMaterial; if (m.map !== wall) { m.map = wall; m.needsUpdate = true; } }
        const top = bd === "palace" ? "marble" : bd === "plain" ? "paper" : bd === "diner" ? "steel" : "wood";
        for (const [k, t] of Object.entries(tops)) t.visible = k === top;
        spin.rotation.y = -0.12 + 0.24 * smooth(c.u); // slow turn so the glaze catches the light
        const isCut = item === "cut" || item === "cutk", fixed = (c.params as { open?: number }).open;
        const t0 = actionT(c, "crunch", c.dur * 0.3), open = !isCut ? 0 : typeof fixed === "number" ? fixed : smooth((c.t - t0) / 0.45);
        cut.set(open); cutK.set(open);
        fl.set(isCut && typeof fixed !== "number" ? Math.min(1, Math.max(0, (c.t - t0) / 0.7)) : 1); fl.inst.visible = item !== "sandwich" && item !== "kipferl" && item !== "cutk";
        const s = p.steam ?? (item === "kipferl" ? 0.35 : 0.7);
        st.set(c.f, item === "sandwich" ? 0.5 : s); st.grp.visible = s > 0;
        const showCup = p.cup ?? (bd === "cafe" || bd === "diner"); mug.visible = mugSteam.grp.visible = showCup; mugSteam.set(c.f + 30, 0.8);
        napkin.visible = bd === "cafe" || bd === "diner";
      },
    };
  },
};
