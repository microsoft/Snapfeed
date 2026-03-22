<?php
/**
 * Snapfeed admin settings page.
 *
 * Registers a settings page under Settings → Snapfeed
 * using the WordPress Settings API.
 */

defined('ABSPATH') || exit;

class Snapfeed_Admin {

    const OPTION_KEY  = 'snapfeed_settings';
    const SETTINGS_GROUP = 'snapfeed_settings_group';
    const PAGE_SLUG   = 'snapfeed-settings';

    /**
     * Default settings values.
     */
    public static function defaults(): array {
        return [
            'enabled'                => '1',
            'tracking_mode'          => 'logged_in',
            'feedback_enabled'       => '1',
            'track_clicks'           => '1',
            'track_navigation'       => '1',
            'track_errors'           => '1',
            'track_api_errors'       => '',
            'rage_click_enabled'     => '1',
            'network_log_enabled'    => '1',
            'session_replay_enabled' => '',
            'turnstile_site_key'     => '',
            'turnstile_secret_key'   => '',
            'rate_limit_max'         => '10',
            'rate_limit_window'      => '60',
            'screenshot_quality'     => '0.6',
            'data_retention_days'    => '90',
        ];
    }

    /**
     * Register the settings menu item.
     */
    public static function register_menu(): void {
        add_options_page(
            __('Snapfeed Settings', 'snapfeed'),
            __('Snapfeed', 'snapfeed'),
            'manage_options',
            self::PAGE_SLUG,
            [self::class, 'render_settings_page']
        );
    }

    /**
     * Register settings, sections, and fields.
     */
    public static function register_settings(): void {
        register_setting(self::SETTINGS_GROUP, self::OPTION_KEY, [
            'type'              => 'array',
            'sanitize_callback' => [self::class, 'sanitize_settings'],
            'default'           => self::defaults(),
        ]);

        // ── General section ──────────────────────────────────────────
        add_settings_section(
            'snapfeed_general',
            __('General', 'snapfeed'),
            function () {
                echo '<p>' . esc_html__('Enable or disable Snapfeed and configure what gets captured.', 'snapfeed') . '</p>';
            },
            self::PAGE_SLUG
        );

        self::add_toggle('enabled', __('Enable Snapfeed', 'snapfeed'), 'snapfeed_general',
            __('Load Snapfeed on the front-end of your site.', 'snapfeed'));
        self::add_select('tracking_mode', __('Tracking Mode', 'snapfeed'), 'snapfeed_general', [
            'logged_in' => __('Logged-in users only (recommended)', 'snapfeed'),
            'everyone'  => __('All visitors', 'snapfeed'),
        ], __('Who gets full telemetry. Anonymous visitors can always submit feedback via Ctrl+Click.', 'snapfeed'));
        self::add_toggle('feedback_enabled', __('Feedback Dialog', 'snapfeed'), 'snapfeed_general',
            __('Allow Cmd+Click / Ctrl+Click feedback with screenshots.', 'snapfeed'));
        self::add_toggle('track_clicks', __('Track Clicks', 'snapfeed'), 'snapfeed_general');
        self::add_toggle('track_navigation', __('Track Navigation', 'snapfeed'), 'snapfeed_general');
        self::add_toggle('track_errors', __('Track Errors', 'snapfeed'), 'snapfeed_general');
        self::add_toggle('track_api_errors', __('Track API Errors', 'snapfeed'), 'snapfeed_general');
        self::add_toggle('rage_click_enabled', __('Rage Click Detection', 'snapfeed'), 'snapfeed_general',
            __('Detect and flag rapid repeated clicks on the same element.', 'snapfeed'));
        self::add_toggle('network_log_enabled', __('Network Request Log', 'snapfeed'), 'snapfeed_general',
            __('Capture a rolling log of recent fetch() calls for feedback context.', 'snapfeed'));
        self::add_toggle('session_replay_enabled', __('Session Replay', 'snapfeed'), 'snapfeed_general',
            __('Record DOM mutations, scroll, and mouse movement (heavier — opt-in).', 'snapfeed'));

        // ── Screenshot section ───────────────────────────────────────
        add_settings_section(
            'snapfeed_screenshot',
            __('Screenshots', 'snapfeed'),
            null,
            self::PAGE_SLUG
        );

        self::add_text('screenshot_quality', __('Screenshot Quality', 'snapfeed'), 'snapfeed_screenshot',
            __('JPEG quality 0–1. Default: 0.6', 'snapfeed'), 'number', '0.1', '1', '0.1');

        // ── Anti-Spam section ────────────────────────────────────────
        add_settings_section(
            'snapfeed_security',
            __('Anti-Spam & Security', 'snapfeed'),
            function () {
                echo '<p>' . esc_html__('Configure rate limiting and Cloudflare Turnstile to prevent spam.', 'snapfeed') . '</p>';
            },
            self::PAGE_SLUG
        );

        self::add_text('rate_limit_max', __('Rate Limit (requests)', 'snapfeed'), 'snapfeed_security',
            __('Max requests per window per IP. Default: 10', 'snapfeed'), 'number', '1', '1000');
        self::add_text('rate_limit_window', __('Rate Limit Window (seconds)', 'snapfeed'), 'snapfeed_security',
            __('Time window in seconds. Default: 60', 'snapfeed'), 'number', '10', '3600');
        self::add_text('turnstile_site_key', __('Turnstile Site Key', 'snapfeed'), 'snapfeed_security',
            __('From your Cloudflare Turnstile dashboard. Leave empty to disable.', 'snapfeed'));
        self::add_text('turnstile_secret_key', __('Turnstile Secret Key', 'snapfeed'), 'snapfeed_security',
            __('Server-side secret key. Never exposed to the browser.', 'snapfeed'), 'password');

        // ── Data Retention section ───────────────────────────────────
        add_settings_section(
            'snapfeed_retention',
            __('Data Retention', 'snapfeed'),
            null,
            self::PAGE_SLUG
        );

        self::add_text('data_retention_days', __('Retention Period (days)', 'snapfeed'), 'snapfeed_retention',
            __('Events older than this are deleted daily. Default: 90', 'snapfeed'), 'number', '1', '3650');

        // ── Agent Access section ─────────────────────────────────────
        add_settings_section(
            'snapfeed_agent_access',
            __('Agent Access', 'snapfeed'),
            [self::class, 'render_agent_access_section'],
            self::PAGE_SLUG
        );
    }

    /**
     * Render the Agent Access info section.
     */
    public static function render_agent_access_section(): void {
        $site_url = rest_url('snapfeed/v1/');
        ?>
        <div style="background: #f0f6fc; border: 1px solid #d0d7de; border-radius: 6px; padding: 16px; max-width: 680px;">
            <h4 style="margin-top: 0;">🤖 <?php esc_html_e('Connecting an AI Agent', 'snapfeed'); ?></h4>
            <p><?php esc_html_e('External agents can read feedback via the REST API using WordPress Application Passwords.', 'snapfeed'); ?></p>

            <ol>
                <li><?php
                    printf(
                        /* translators: %s: link to profile page */
                        esc_html__('Go to %s and create an Application Password.', 'snapfeed'),
                        '<a href="' . esc_url(admin_url('profile.php')) . '">' . esc_html__('Users → Profile', 'snapfeed') . '</a>'
                    );
                ?></li>
                <li><?php esc_html_e('Give the agent the username and application password.', 'snapfeed'); ?></li>
                <li><?php esc_html_e('The agent authenticates with HTTP Basic Auth:', 'snapfeed'); ?></li>
            </ol>

            <pre style="background: #1e1e2e; color: #cdd6f4; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 13px;"><code># List feedback sessions
curl -u username:app_password <?php echo esc_url($site_url . 'sessions'); ?>

# Get feedback events
curl -u username:app_password <?php echo esc_url($site_url . 'events?event_type=feedback'); ?>

# Get screenshot
curl -u username:app_password <?php echo esc_url($site_url . 'events/42/screenshot'); ?> --output screenshot.jpg</code></pre>
        </div>
        <?php
    }

    /**
     * Sanitize settings on save.
     */
    public static function sanitize_settings(array $input): array {
        $defaults = self::defaults();
        $clean    = [];

        // Toggles (checkbox → '1' or '')
        $toggles = [
            'enabled', 'feedback_enabled', 'track_clicks', 'track_navigation',
            'track_errors', 'track_api_errors', 'rage_click_enabled',
            'network_log_enabled', 'session_replay_enabled',
        ];
        foreach ($toggles as $key) {
            $clean[$key] = !empty($input[$key]) ? '1' : '';
        }

        // Select fields
        $clean['tracking_mode'] = in_array($input['tracking_mode'] ?? '', ['logged_in', 'everyone'], true)
            ? $input['tracking_mode']
            : 'logged_in';

        // Numeric fields
        $clean['rate_limit_max']      = absint($input['rate_limit_max'] ?? $defaults['rate_limit_max']);
        $clean['rate_limit_window']   = absint($input['rate_limit_window'] ?? $defaults['rate_limit_window']);
        $clean['data_retention_days'] = absint($input['data_retention_days'] ?? $defaults['data_retention_days']);

        // Float
        $quality = floatval($input['screenshot_quality'] ?? $defaults['screenshot_quality']);
        $clean['screenshot_quality'] = max(0.1, min(1.0, $quality));

        // Text / secrets
        $clean['turnstile_site_key']   = sanitize_text_field($input['turnstile_site_key'] ?? '');
        $clean['turnstile_secret_key'] = sanitize_text_field($input['turnstile_secret_key'] ?? '');

        return $clean;
    }

    /**
     * Render the settings page.
     */
    public static function render_settings_page(): void {
        if (!current_user_can('manage_options')) return;
        ?>
        <div class="wrap">
            <h1>🔭 <?php echo esc_html(get_admin_page_title()); ?></h1>
            <form action="options.php" method="post">
                <?php
                settings_fields(self::SETTINGS_GROUP);
                do_settings_sections(self::PAGE_SLUG);
                submit_button(__('Save Settings', 'snapfeed'));
                ?>
            </form>
        </div>
        <?php
    }

    // ── Field helpers ────────────────────────────────────────────────

    private static function add_toggle(string $key, string $label, string $section, string $description = ''): void {
        add_settings_field(
            'snapfeed_' . $key,
            $label,
            function () use ($key, $description) {
                $settings = get_option(self::OPTION_KEY, self::defaults());
                $checked  = !empty($settings[$key]) ? 'checked' : '';
                echo '<label>';
                echo '<input type="checkbox" name="' . esc_attr(self::OPTION_KEY . '[' . $key . ']') . '" value="1" ' . $checked . '>';
                if ($description) {
                    echo ' <span class="description">' . esc_html($description) . '</span>';
                }
                echo '</label>';
            },
            self::PAGE_SLUG,
            $section
        );
    }

    private static function add_text(
        string $key,
        string $label,
        string $section,
        string $description = '',
        string $type = 'text',
        string $min = '',
        string $max = '',
        string $step = ''
    ): void {
        add_settings_field(
            'snapfeed_' . $key,
            $label,
            function () use ($key, $description, $type, $min, $max, $step) {
                $settings = get_option(self::OPTION_KEY, self::defaults());
                $value    = $settings[$key] ?? '';
                $attrs    = '';
                if ($min !== '') $attrs .= ' min="' . esc_attr($min) . '"';
                if ($max !== '') $attrs .= ' max="' . esc_attr($max) . '"';
                if ($step !== '') $attrs .= ' step="' . esc_attr($step) . '"';

                echo '<input type="' . esc_attr($type) . '" name="' . esc_attr(self::OPTION_KEY . '[' . $key . ']') . '"'
                    . ' value="' . esc_attr($value) . '" class="regular-text"' . $attrs . '>';
                if ($description) {
                    echo '<p class="description">' . esc_html($description) . '</p>';
                }
            },
            self::PAGE_SLUG,
            $section
        );
    }

    private static function add_select(string $key, string $label, string $section, array $options, string $description = ''): void {
        add_settings_field(
            'snapfeed_' . $key,
            $label,
            function () use ($key, $options, $description) {
                $settings = get_option(self::OPTION_KEY, self::defaults());
                $current  = $settings[$key] ?? '';
                echo '<select name="' . esc_attr(self::OPTION_KEY . '[' . $key . ']') . '">';
                foreach ($options as $value => $text) {
                    $selected = selected($current, $value, false);
                    echo '<option value="' . esc_attr($value) . '"' . $selected . '>' . esc_html($text) . '</option>';
                }
                echo '</select>';
                if ($description) {
                    echo '<p class="description">' . esc_html($description) . '</p>';
                }
            },
            self::PAGE_SLUG,
            $section
        );
    }
}
