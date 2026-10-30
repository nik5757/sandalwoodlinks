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

        // 1. Authenticate User via Permanent API Token
        let { data: users, error: userErr } = await supabase
            .from('users')
            .select('id, telegram_id, is_blocked, api_key')
            .eq('api_key', cleanApi)
            .limit(1);

        let user = users && users[0];

        // Fallback: If token follows permanent deterministic format sw_<tg_id>_<hash>, bind it permanently if user had null api_key
        if (!user && cleanApi.startsWith('sw_')) {
            const parts = cleanApi.split('_');
            const possibleTgId = parseInt(parts[1], 10);
            if (possibleTgId && !isNaN(possibleTgId)) {
                const { data: fallbackUsers } = await supabase
                    .from('users')
                    .select('id, telegram_id, is_blocked, api_key')
                    .eq('telegram_id', possibleTgId)
                    .limit(1);

                if (fallbackUsers && fallbackUsers[0] && !fallbackUsers[0].api_key) {
                    await supabase.from('users').update({ api_key: cleanApi }).eq('id', fallbackUsers[0].id);
                    user = { ...fallbackUsers[0], api_key: cleanApi };
                }
            }
        }

        if (userErr || !user) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid API Token',
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
