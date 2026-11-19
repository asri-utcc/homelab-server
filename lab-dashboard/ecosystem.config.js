// ── PM2 config สำหรับ lab-dashboard ────────────────────────────────────────
// เรียก: pm2 start ecosystem.config.js
module.exports = {
    apps: [
        {
            name: 'lab-dashboard',
            script: 'server.js',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            max_memory_restart: '300M',
            watch: false,
            time: true,
            env: {
                NODE_ENV: 'production',
                DASHBOARD_PORT: '8090',
                // ผูกเฉพาะ gateway ของ docker bridge (172.17.0.1) เท่านั้น
                // จึงเข้าถึงได้จาก Caddy เท่านั้น — LAN/tailnet ที่พอร์ตตรงจะไม่ผ่าน
                // (ถ้าผูก 0.0.0.0 ผู้ใช้บน tailnet จะเข้าข้าม basic auth ได้)
                DASHBOARD_HOST: '172.17.0.1',
                LAB_DIR: '/home/dev/projects/lab-stack',
                TAIL_HOST: 'homelab.tail285279.ts.net',
                // จำกัดเฉพาะรายการที่อนุญาตให้ควบคุมได้
                ALLOWED_CONTAINERS: 'lab-',
                ALLOWED_PM2: 'pm2-ui,onepercentbot,lab-dashboard',
                // จำนวนรอบคิด/เรียกเครื่องมือสูงสุดของ deepseek-agent.js (default 20)
                DEEPSEEK_MAX_STEPS: '20',
            },
        },
    ],
};
