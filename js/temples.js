import * as forest from "./forest_gamedata.js";
import * as light from "./light_gamedata.js";
import * as ice from "./ice_gamedata.js";
import * as crystal from "./crystal_gamedata.js";

export const TEMPLE_ORDER = ["forest", "light", "ice", "crystal"];

export const TEMPLES = {
  forest: {
    id: "forest",
    title: "Forest Temple",
    shortTitle: "Forest",
    folder: "Forest Temple",
    accent: "#59c159",
    data: forest,
  },
  light: {
    id: "light",
    title: "Light Temple",
    shortTitle: "Light",
    folder: "Light Temple",
    accent: "#f4d03f",
    data: light,
  },
  ice: {
    id: "ice",
    title: "Ice Temple",
    shortTitle: "Ice",
    folder: "Ice Temple",
    accent: "#6ec6ff",
    data: ice,
  },
  crystal: {
    id: "crystal",
    title: "Crystal Temple",
    shortTitle: "Crystal",
    folder: "Crystal Temple",
    accent: "#c77dff",
    data: crystal,
  },
};
