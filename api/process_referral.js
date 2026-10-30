// FILE: api/process_referral.js
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { referrer_id, new_user } = req.body || {};
    const BOT_TOKEN = process.env.BOT_TOKEN;

    if (!BOT_TOKEN) return res.status(500).json({ error: 'BOT_TOKEN missing' });

    try {
        const messageText = `🎉 <b>New Partner Joined Your Network!</b>\n\n👤 <b>${new_user?.first_name || 'Creator'}</b> ${new_user?.username ? '(@' + new_user.username + ')' : ''} registered via your referral link.\n\n💰 You will automatically earn lifetime commission on every verified view they generate!`;

        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: referrer_id,
                text: messageText,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: "📊 Open Partner Network", url: "https://t.me/SandalwoodLinksBot" }]]
                }
            })
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
