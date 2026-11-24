import type { MetadataRoute } from "next";

/** Installable on Android / iOS home screens and usable full-screen on any phone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Holool His",
    short_name: "Holool His",
    description: "Hospital HIS team tracking system",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f7fb",
    theme_color: "#1e3a8a",
    icons: [
      { src: "/icon.png", sizes: "935x267", type: "image/png", purpose: "any" },
      { src: "/logo.png", sizes: "any", type: "image/png", purpose: "any" },
    ],
  };
}
