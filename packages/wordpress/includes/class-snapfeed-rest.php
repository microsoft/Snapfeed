<?php
/**
 * Snapfeed REST API endpoints.
 *
 * Namespace: snapfeed/v1
 *
 * POST /events          — Public (rate-limited, optional Turnstile)
 * GET  /events          — Requires edit_posts (Application Passwords supported)
 * GET  /sessions        — Requires edit_posts
 * GET  /events/<id>/screenshot — Requires edit_posts
 * POST /events/<id>/resolve   — Requires edit_posts
 */

defined('ABSPATH') || exit;

class Snapfeed_REST {

    const NAMESPACE = 'snapfeed/v1';

    public static function register_routes(): void {

        // ── POST /events — ingest telemetry (public) ────────────────
        register_rest_route(self::NAMESPACE, '/events', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'handle_post_events'],
            'permission_callback' => '__return_true',
        ]);

        // ── GET /events — query events (auth required) ──────────────
        register_rest_route(self::NAMESPACE, '/events', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'handle_get_events'],
            'permission_callback' => [self::class, 'can_read_feedback'],
            'args'                => [
                'session_id' => [
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ],
                'event_type' => [
                    'type'              => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ],
                'limit' => [
                    'type'              => 'integer',
                    'default'           => 200,
                    'sanitize_callback' => 'absint',
                ],
            ],
        ]);

        // ── GET /sessions — list sessions (auth required) ───────────
        register_rest_route(self::NAMESPACE, '/sessions', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'handle_get_sessions'],
            'permission_callback' => [self::class, 'can_read_feedback'],
            'args'                => [
                'limit' => [
                    'type'              => 'integer',
                    'default'           => 20,
                    'sanitize_callback' => 'absint',
                ],
            ],
        ]);

        // ── GET /events/<id>/screenshot — serve JPEG (auth required) ─
        register_rest_route(self::NAMESPACE, '/events/(?P<id>\d+)/screenshot', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'handle_get_screenshot'],
            'permission_callback' => [self::class, 'can_read_feedback'],
            'args'                => [
                'id' => [
                    'validate_callback' => function ($val) { return is_numeric($val); },
                    'sanitize_callback' => 'absint',
                    'required'          => true,
                ],
            ],
        ]);

        // ── POST /events/<id>/resolve — mark resolved (auth required) ─
        register_rest_route(self::NAMESPACE, '/events/(?P<id>\d+)/resolve', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'handle_resolve_event'],
            'permission_callback' => [self::class, 'can_read_feedback'],
            'args'                => [
                'id' => [
                    'validate_callback' => function ($val) { return is_numeric($val); },
                    'sanitize_callback' => 'absint',
                    'required'          => true,
                ],
                'note' => [
                    'type'              => 'string',
                    'default'           => '',
                    'sanitize_callback' => 'sanitize_textarea_field',
                ],
            ],
        ]);
    }

    // ── Permission check ─────────────────────────────────────────────

    public static function can_read_feedback(): bool {
        return current_user_can('edit_posts');
    }

    // ── Rate limiting (for public POST) ──────────────────────────────

    private static function check_rate_limit(): bool {
        $settings = get_option('snapfeed_settings', []);
        $max      = absint($settings['rate_limit_max'] ?? 10);
        $window   = absint($settings['rate_limit_window'] ?? 60);

        $ip  = self::get_client_ip();
        $key = 'snapfeed_rl_' . md5($ip);

        $count = get_transient($key);
        if ($count === false) {
            set_transient($key, 1, $window);
            return true;
        }

        if ((int) $count >= $max) {
            return false;
        }

        set_transient($key, (int) $count + 1, $window);
        return true;
    }

    private static function get_client_ip(): string {
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $parts = explode(',', sanitize_text_field(wp_unslash($_SERVER['HTTP_X_FORWARDED_FOR'])));
            return trim($parts[0]);
        }
        if (!empty($_SERVER['HTTP_X_REAL_IP'])) {
            return sanitize_text_field(wp_unslash($_SERVER['HTTP_X_REAL_IP']));
        }
        return sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1'));
    }

    // ── Handlers ─────────────────────────────────────────────────────

    public static function handle_post_events(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        // Rate limit
        if (!self::check_rate_limit()) {
            return new \WP_Error(
                'rate_limited',
                'Too many requests. Please try again later.',
                ['status' => 429]
            );
        }

        // Turnstile verification (if configured)
        $turnstile_error = Snapfeed_Captcha::verify_request($request);
        if (is_wp_error($turnstile_error)) {
            return $turnstile_error;
        }

        // Parse and validate body
        $body   = $request->get_json_params();
        $events = $body['events'] ?? null;

        if (!is_array($events) || empty($events)) {
            return new \WP_Error(
                'invalid_payload',
                'events array required',
                ['status' => 400]
            );
        }

        // Payload size check
        $settings       = get_option('snapfeed_settings', []);
        $max_screenshot  = 5 * 1024 * 1024; // 5 MB

        foreach ($events as $event) {
            if (!empty($event['screenshot']) && is_string($event['screenshot'])) {
                $screenshot_bytes = (int) ceil(strlen($event['screenshot']) * 3 / 4);
                if ($screenshot_bytes > $max_screenshot) {
                    return new \WP_Error(
                        'screenshot_too_large',
                        'Screenshot exceeds 5MB limit',
                        ['status' => 413]
                    );
                }
            }
        }

        // Insert into database
        $inserted = Snapfeed_DB::insert_events($events);

        return rest_ensure_response(['accepted' => $inserted]);
    }

    public static function handle_get_events(\WP_REST_Request $request): \WP_REST_Response {
        $rows = Snapfeed_DB::get_events([
            'session_id' => $request->get_param('session_id'),
            'event_type' => $request->get_param('event_type'),
            'limit'      => $request->get_param('limit'),
        ]);

        return rest_ensure_response($rows);
    }

    public static function handle_get_sessions(\WP_REST_Request $request): \WP_REST_Response {
        $limit = $request->get_param('limit') ?: 20;
        $rows  = Snapfeed_DB::get_sessions($limit);
        return rest_ensure_response($rows);
    }

    public static function handle_get_screenshot(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $event_id   = (int) $request->get_param('id');
        $screenshot = Snapfeed_DB::get_screenshot($event_id);

        if (!$screenshot) {
            return new \WP_Error(
                'no_screenshot',
                'No screenshot for this event',
                ['status' => 404]
            );
        }

        $jpeg_bytes = base64_decode($screenshot);

        // Send raw JPEG response
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . strlen($jpeg_bytes));
        echo $jpeg_bytes;
        exit;
    }

    public static function handle_resolve_event(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $event_id = (int) $request->get_param('id');
        $note     = $request->get_param('note') ?: '';
        $user_id  = get_current_user_id();

        $result = Snapfeed_DB::resolve_event($event_id, $user_id, $note);

        if (!$result) {
            return new \WP_Error(
                'resolve_failed',
                'Could not resolve event',
                ['status' => 500]
            );
        }

        return rest_ensure_response(['resolved' => true, 'event_id' => $event_id]);
    }
}
