import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '..', '');
    return {
        plugins: [react()],
        build: { outDir: 'build' },
        envDir: '..',
        server: {
            proxy: {
                '/api': {
                    target: env.BACKEND_URL || 'http://localhost:20000',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api/, ''),
                },
            },
        },
    };
});
