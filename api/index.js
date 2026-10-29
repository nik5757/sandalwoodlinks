// FILE: api/index.js
const { createClient } = require('@supabase/supabase-js');

const BOT_USERNAME = 'SandalwoodLinksBot';
const APP_SHORT_NAME = 'httpssandalwoodlinksvercela';

module.exports = async function handler(req, res) {
    // Enable CORS for external developers & bots
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Support both GET (?api=...&url=...) and POST JSON body
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

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid URL format. Must start with http:// or https://',
            shortenedUrl: ''
        });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ status: 'error', message: 'Server configuration error' });
    }

    const cleanUrl = supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
    const supabase = createClient(cleanUrl, supabaseKey.trim());

    try {
        // 1. Authenticate User via API Token
        const { data: user, error: userErr } = await supabase
            .from('users')
            .select('id, is_blocked')
            .eq('api_key', api.trim())
            .single();

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
        let shortId = alias ? alias.trim().replace(/[^a-zA-Z0-9_-]/g, '') : Math.random().toString(36).substring(2, 8);
        if (!shortId || shortId.length < 3) {
            shortId = Math.random().toString(36).substring(2, 8);
        }

        if (alias) {
            const { data: existing } = await supabase
                .from('links')
                .select('id')
                .eq('short_id', shortId)
                .single();

            if (existing) {
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
                original_url: url.trim(),
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

        // Support plain text response if &format=text is used
        if (format === 'text') {
            res.setHeader('Content-Type', 'text/plain');
            return res.status(200).send(shortUrl);
        }

        // Standard JSON response (Compatible with all Telegram Shortener Bots)
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
