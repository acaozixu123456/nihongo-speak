// Azure voices, tried in order (see lib/azure.ts). The HD voices sound the most
// like real conversation; the standard voices after "|" are the free fallback.
// Only Masaru and Nanami have Japanese HD voices, so the role-play partner and
// most speakers use them, and the rest give a scene a few different voices.
export const HD_MAN = "ja-JP-Masaru:DragonHDLatestNeural|ja-JP-KeitaNeural";
export const HD_MAN_CALM = "ja-JP-Masaru:DragonHDLatestNeural|ja-JP-NanamiNeural@chat";
export const HD_WOMAN = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-MayuNeural";
export const HD_WOMAN_POLITE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural@customerservice";
export const MAN_2 = "ja-JP-DaichiNeural";
export const MAN_3 = "ja-JP-NaokiNeural";
export const WOMAN_2 = "ja-JP-AoiNeural";
export const WOMAN_3 = "ja-JP-ShioriNeural";
