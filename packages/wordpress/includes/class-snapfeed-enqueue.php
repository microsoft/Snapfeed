<?php
/**
 * Snapfeed front-end script enqueuing.
 *
 * Loads the Snapfeed IIFE bundle and a thin init wrapper on public pages.
 * Configuration is passed from WP options to JavaScript via wp_localize_script.
 */

defined('ABSPATH') || exit;

class Snapfeed_Enqueue {

    public static function enqueue_frontend(): void {
        $settings = get_option('snapfeed_settings', []);

        if (empty($settings['enabled'])) {
            return;
        }

        // Don't load in admin (admin has its own dashboard)
        if (is_admin()) {
            return;
        }

        // Tracking mode: 'logged_in' (default) only loads for authenticated users
        $mode = $settings['tracking_mode'] ?? 'logged_in';
        if ($mode === 'logged_in' && !is_user_logged_in()) {
            return;
        }

        // 1. Snapfeed IIFE bundle
        wp_enqueue_script(
            'snapfeed',
            SNAPFEED_PLUGIN_URL . 'assets/js/snapfeed.global.js',
            [],
            SNAPFEED_VERSION,
            ['strategy' => 'defer', 'in_footer' => true]
        );

        // 2. Turnstile widget (only if configured)
        if (!empty($settings['turnstile_site_key'])) {
            wp_enqueue_script(
                'cloudflare-turnstile',
                'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
                [],
                null,
                ['strategy' => 'defer', 'in_footer' => true]
            );
        }

        // 3. Init wrapper
        wp_enqueue_script(
            'snapfeed-wp-init',
            SNAPFEED_PLUGIN_URL . 'assets/js/snapfeed-wp-init.js',
            ['snapfeed'],
            SNAPFEED_VERSION,
            ['strategy' => 'defer', 'in_footer' => true]
        );

        // 4. Pass config from PHP → JS
        wp_localize_script('snapfeed-wp-init', 'SnapfeedWP', self::build_js_config($settings));
    }

    private static function build_js_config(array $settings): array {
        return [
            'endpoint'            => esc_url_raw(rest_url('snapfeed/v1/events')),
            'nonce'               => wp_create_nonce('wp_rest'),
            'feedbackEnabled'     => !empty($settings['feedback_enabled']),
            'trackClicks'         => !empty($settings['track_clicks']),
            'trackNavigation'     => !empty($settings['track_navigation']),
            'trackErrors'         => !empty($settings['track_errors']),
            'trackApiErrors'      => !empty($settings['track_api_errors']),
            'rageClickEnabled'    => !empty($settings['rage_click_enabled']),
            'networkLogEnabled'   => !empty($settings['network_log_enabled']),
            'sessionReplay'       => !empty($settings['session_replay_enabled']),
            'screenshotQuality'   => (float) ($settings['screenshot_quality'] ?? 0.6),
            'turnstileSiteKey'    => $settings['turnstile_site_key'] ?? '',
        ];
    }
}
