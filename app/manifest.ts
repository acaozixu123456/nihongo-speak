import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "日语听说练习",
    short_name: "日语练习",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f2ec",
    theme_color: "#d9480f",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
