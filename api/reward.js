// FILE: api/reward.js
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { short_id, clicker_tg_id, ads_watched } = req.body || {};

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ error: 'Vercel ENV variables missing' });
    }

    const cleanUrl = supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");

    try {
        const supabase = createClient(cleanUrl, supabaseKey.trim());

        // 1. Fetch Link Data
        const { data: linkRows, error: linkErr } = await supabase
            .from('links')
            .select('*')
            .eq('short_id', short_id)
            .order('created_at', { ascending: false })
            .limit(1);

        const linkData = linkRows && linkRows[0];
        if (linkErr || !linkData) {
            return res.status(404).json({ error: 'Link not found' });
        }

        // 2. Check Duplicate Click in click_logs
        if (clicker_tg_id && Number(clicker_tg_id) !== 0) {
            const { data: existingLogs } = await supabase
                .from('click_logs')
                .select('id')
                .eq('link_id', linkData.id)
                .eq('clicker_tg_id', clicker_tg_id)
                .limit(1);

            if (existingLogs && existingLogs.length > 0) {
                return res.status(200).json({ success: false, message: 'Duplicate click ignored' });
            }

            await supabase.from('click_logs').insert([{
                link_id: linkData.id,
                clicker_tg_id: clicker_tg_id
            }]);
        } else {
            await supabase.from('click_logs').insert([{
                link_id: linkData.id,
                clicker_tg_id: 0
            }]);
        }

        // 3. Fetch Admin Settings & Creator Data for Automatic 1-20 Ads = 1-20 CPM Rule
        const { data: settingsRows } = await supabase.from('settings').select('*').limit(1);
        const adminSettings = (settingsRows && settingsRows[0]) || {};

        const { data: userRows } = await supabase
            .from('users')
            .select('*')
            .eq('id', linkData.user_id)
            .limit(1);
        const userData = userRows && userRows[0];

        // Priority: ads_watched (if valid 1..20) -> adminSettings.ads_per_link (1..20) -> 1
        const rawAdTier = parseInt(ads_watched || adminSettings.ads_per_link || adminSettings.cpm || 1, 10);
        const clampedTier = Math.max(1, Math.min(20, isNaN(rawAdTier) ? 1 : rawAdTier));

        // 1 Ad = $1 CPM, 2 Ads = $2 CPM ... up to 20 Ads = $20 CPM
        const cpm = clampedTier * 1.0;
        const earn_amount = cpm / 1000;

        // 4. Update LINK table
        await supabase.from('links').update({
            clicks: (linkData.clicks || 0) + 1,
            earnings: parseFloat(((linkData.earnings || 0) + earn_amount).toFixed(6))
        }).eq('id', linkData.id);

        // 5. Update USER table & Referrer Commission
        if (userData) {
            await supabase.from('users').update({
                balance: parseFloat(((userData.balance || 0) + earn_amount).toFixed(6)),
                today_earnings: parseFloat(((userData.today_earnings || 0) + earn_amount).toFixed(6)),
                total_earnings: parseFloat(((userData.total_earnings || 0) + earn_amount).toFixed(6)),
                total_clicks: (userData.total_clicks || 0) + 1,
                today_clicks: (userData.today_clicks || 0) + 1
            }).eq('id', userData.id);

            // 6. Referral Commission Logic
            const referPercent = adminSettings.refer_percent ? Number(adminSettings.refer_percent) : 10;
            if (referPercent > 0 && userData.telegram_id) {
                const { data: refRows } = await supabase
                    .from('referrals')
                    .select('*')
                    .eq('referred_tg_id', userData.telegram_id)
                    .limit(1);

                const referralData = refRows && refRows[0];
                if (referralData && referralData.referrer_tg_id) {
                    const { data: referrerRows } = await supabase
                        .from('users')
                        .select('*')
                        .eq('telegram_id', referralData.referrer_tg_id)
                        .limit(1);

                    const referrerData = referrerRows && referrerRows[0];
                    if (referrerData) {
                        const referComm = earn_amount * (referPercent / 100);
                        await supabase.from('users').update({
                            balance: parseFloat(((referrerData.balance || 0) + referComm).toFixed(6)),
                            total_earnings: parseFloat(((referrerData.total_earnings || 0) + referComm).toFixed(6))
                        }).eq('id', referrerData.id);

                        if (referralData.status !== 'active') {
                            await supabase.from('referrals').update({ status: 'active' }).eq('id', referralData.id);
                        }
                    }
                }
            }
        }

        return res.status(200).json({
            success: true,
            cpm_applied: cpm,
            earn_amount: earn_amount,
            message: `Reward added at $${cpm.toFixed(2)} CPM (${clampedTier} Ads)`
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
