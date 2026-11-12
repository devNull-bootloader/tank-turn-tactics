const { t, resolveLocale, SUPPORTED } = require('../libs/i18n');

describe('i18n', () => {
    it('supports en and de', () => {
        expect(SUPPORTED).toEqual(expect.arrayContaining(['en', 'de']));
        expect(resolveLocale('de-DE')).toBe('de');
        expect(resolveLocale('fr')).toBe('en');
    });

    it('translates nested keys with vars', () => {
        expect(t('en', 'auth.login')).toBe('Login');
        expect(t('de', 'auth.login')).toBe('Anmelden');
        expect(t('de', 'home.welcome', { name: 'Theo' })).toBe('Willkommen, Theo');
        expect(t('en', 'create.hours', { n: 12 })).toBe('12 hours');
        expect(t('en', 'auth.debugTab')).toBe('Debug');
        expect(t('en', 'auth.botsTab')).toBe('Bots');
        expect(t('en', 'auth.tutorialTab')).toBe('Tutorial');
        expect(t('en', 'bots.paceQuick')).toMatch(/Quick/i);
        expect(t('en', 'game.helpBanner')).toMatch(/Move/i);
        expect(t('de', 'bots.title')).toBe('Gegen Bots spielen');
        expect(t('de', 'tutorial.title')).toBe('Tutorial');
        expect(t('de', 'debug.title')).toBe('Debug-Konsole');
        expect(t('en', 'debug.subtitle', { name: 'debug_abc' })).toBe('Signed in as debug_abc');
        expect(t('en', 'coach.moveTitle')).toBe('Move');
    });

    it('falls back to english for missing keys', () => {
        expect(t('de', 'meta.title')).toBe('Tank Turn Tactics');
        expect(t('en', 'does.not.exist')).toBe('does.not.exist');
    });
});
