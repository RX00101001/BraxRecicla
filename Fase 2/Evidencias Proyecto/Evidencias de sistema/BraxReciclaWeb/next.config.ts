import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',        // genera una carpeta /out con HTML/CSS/JS estáticos
  trailingSlash: true,     // compatibilidad con Apache (cPanel)
  images: {
    unoptimized: true,     // imágenes sin optimización server-side (requerido en export estático)
  },
};

export default nextConfig;
