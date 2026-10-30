// FILE: api/index.js
const { createClient } = require('@supabase/supabase-js');

const BOT_USERNAME = 'SandalwoodLinksBot';
const APP_SHORT_NAME = 'httpssandalwoodlinksvercela';

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const api = req.query.api || req.body?.api;
    const url = req.query.url || req.body?.url;
    const alias = req.query.alias || req.body?.alias;
    const format = req.query.format || req.body?.format;

    if (!api || !url) {
        return res.status(400).json({
            status: 'error',
            message: 'Missing required parameters: api and url',
            shortenedUrl: ''
        });
    }

    let cleanDestUrl = String(url).trim();
    if (!/^https?:\/\//i.test(cleanDestUrl)) {
        cleanDestUrl = 'https://' + cleanDestUrl;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ status: 'error', message: 'Server configuration error' });
    }

    const cleanUrl = supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
    const supabase = createClient(cleanUrl, supabaseKey.trim());

    try {
        const cleanApi = String(api).trim();

        // 1. Authenticate User via Unlocked Permanent API Token
        // Normal users without an unlocked api_key in the database are rejected
        const { data: users, error: userErr } = await supabase
            .from('users')
            .select('id, telegram_id, is_blocked, api_key')
            .eq('api_key', cleanApi)
            .not('api_key', 'is', null)
            .limit(1);

        const user = users && users[0];

        if (userErr || !user || !user.api_key) {
            return res.status(401).json({
                status: 'error',
                message: 'API Token not unlocked or invalid. Convert at least 1 link in the app first to unlock your API.',
                shortenedUrl: ''
            });
        }

        if (user.is_blocked) {
            return res.status(403).json({
                status: 'error',
                message: 'Account is suspended',
                shortenedUrl: ''
            });
        }

        // 2. Generate or Validate Custom Alias / Short ID
        let shortId = alias ? String(alias).trim().replace(/[^a-zA-Z0-9_-]/g, '') : Math.random().toString(36).substring(2, 8);
        if (!shortId || shortId.length < 3) {
            shortId = Math.random().toString(36).substring(2, 8);
        }

        if (alias) {
            const { data: existing } = await supabase
                .from('links')
                .select('id')
                .eq('short_id', shortId)
                .limit(1);

            if (existing && existing.length > 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Alias already exists. Choose another one.',
                    shortenedUrl: ''
                });
            }
        }

        // 3. Insert Short Link into Database
        const { error: insertErr } = await supabase
            .from('links')
            .insert([{
                original_url: cleanDestUrl,
                short_id: shortId,
                user_id: user.id
            }]);

        if (insertErr) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create short link',
                shortenedUrl: ''
            });
        }

        const shortUrl = `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=link_${shortId}`;

        if (format === 'text') {
            res.setHeader('Content-Type', 'text/plain');
            return res.status(200).send(shortUrl);
        }

        return res.status(200).json({
            status: 'success',
            shortenedUrl: shortUrl
        });

    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message,
            shortenedUrl: ''
        });
    }
};
