/**
 * WhatItCanDo — the "What it can do" section of a bot's connections panel
 * on the team diagram (DASH-139 screen 1b), after "Gets work from".
 *
 * A placeholder slot: DASH-126 fills it with what this bot's own setup
 * allows (files and shell, what it asks you before, commands, each
 * provider's allowed tools, the always-blocked list) and an Edit button.
 * Until then it renders nothing.
 *
 * @param {object} bot
 * @param {() => void} [onEdit]  opens the bot's Settings
 */
// eslint-disable-next-line no-unused-vars
export const WhatItCanDo = ({ bot, onEdit = null }) => null;

export default WhatItCanDo;
