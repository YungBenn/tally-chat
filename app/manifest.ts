import type { MetadataRoute } from "next";

// Installable app (spec phase 4): no service worker or offline mode, which install doesn't
// need and a remote provider can't use. Icons live in public/icons, outside the login proxy.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "tally.chat",
    short_name: "tally",
    description: "The chat app that shows you what you are paying for.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f7",
    theme_color: "#faf9f7",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
