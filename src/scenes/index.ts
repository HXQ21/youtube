// Scene registry. A storyboard refers to scenes by id; adding an episode that only uses these scenes needs no
// change to the render core. A dish that needs new geometry adds a scene file and one entry below.
import type { SceneDef } from "../core/types";
import { pastryScene } from "./pastry";
import { laminationScene } from "./lamination";
import { bakeryScene } from "./bakery";
import { streetScene, siegeScene } from "./street";
import { pageScene, factoryScene } from "./docs";

export const SCENES: Record<string, SceneDef> = Object.fromEntries([pastryScene, laminationScene, bakeryScene, streetScene, siegeScene, pageScene, factoryScene].map((s) => [s.id, s]));
