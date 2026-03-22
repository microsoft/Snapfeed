<?php
/**
 * Snapfeed Turnstile CAPTCHA integration.
 *
 * Verifies Cloudflare Turnstile tokens on the server side.
 * Token is sent by the client as X-Turnstile-Token header.
 */

defined('ABSPATH') || exit;

class Snapfeed_Captcha {

    const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    /**
     * Verify the Turnstile token from a REST request.
     *
     * Returns null if verification passes (or is not configured).
     * Returns WP_Error if verification fails.
     */
    public static function verify_request(\WP_REST_Request $request): ?\WP_Error {
        $settings   = get_option('snapfeed_settings', []);
        $secret_key = $settings['turnstile_secret_key'] ?? '';

        // If no secret key configured, skip verification
        if (empty($secret_key)) {
            return null;
        }

        $token = $request->get_header('X-Turnstile-Token');
        if (empty($token)) {
            return new \WP_Error(
                'captcha_missing',
                'CAPTCHA token required',
                ['status' => 403]
            );
        }

        $ip = self::get_client_ip();

        $response = wp_remote_post(self::VERIFY_URL, [
            'body'    => [
                'secret'   => $secret_key,
                'response' => $token,
                'remoteip' => $ip,
            ],
            'timeout' => 10,
        ]);

        if (is_wp_error($response)) {
            // If Cloudflare is unreachable, allow the request (fail-open)
            return null;
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);

        if (empty($body['success'])) {
            return new \WP_Error(
                'captcha_failed',
                'CAPTCHA verification failed',
                ['status' => 403]
            );
        }

        return null;
    }

    private static function get_client_ip(): string {
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $parts = explode(',', sanitize_text_field(wp_unslash($_SERVER['HTTP_X_FORWARDED_FOR'])));
            return trim($parts[0]);
        }
        return sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1'));
    }
}
