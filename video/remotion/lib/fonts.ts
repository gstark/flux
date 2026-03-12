import {
  fontFamily as jetBrainsMonoFamily,
  loadFont as loadJetBrainsMono,
} from "@remotion/google-fonts/JetBrainsMono";
import {
  loadFont as loadSpaceGrotesk,
  fontFamily as spaceGroteskFamily,
} from "@remotion/google-fonts/SpaceGrotesk";

// Load both fonts with the weights we need
loadSpaceGrotesk("normal", { weights: ["300", "400", "500", "600", "700"] });
loadJetBrainsMono("normal", { weights: ["400", "500", "700"] });

export const FONT_DISPLAY = spaceGroteskFamily;
export const FONT_MONO = jetBrainsMonoFamily;
