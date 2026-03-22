<?php
/**
 * Plugin Name: Snapfeed
 * Plugin URI:  https://github.com/microsoft/snapfeed
 * Description: Close the loop between humans and AI agents. Capture UI feedback — screenshots, clicks, errors, context — and feed it straight back to the agent that built the interface.
 * Version:     0.1.0
 * Author:      Microsoft
 * Author URI:  https://github.com/microsoft
 * License:     MIT
 * License URI: https://opensource.org/licenses/MIT
 * Text Domain: snapfeed
 * Requires at least: 5.6
 * Requires PHP: 7.4
 */

defined('ABSPATH') || exit;

define('SNAPFEED_VERSION', '0.1.0');
define('SNAPFEED_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('SNAPFEED_PLUGIN_URL', plugin_dir_url(__FILE__));
define('SNAPFEED_PLUGIN_FILE', __FILE__);

// Autoload plugin classes
require_once SNAPFEED_PLUGIN_DIR . 'includes/class-snapfeed-db.php';
require_once SNAPFEED_PLUGIN_DIR . 'includes/class-snapfeed-rest.php';
require_once SNAPFEED_PLUGIN_DIR . 'includes/class-snapfeed-enqueue.php';
require_once SNAPFEED_PLUGIN_DIR . 'includes/class-snapfeed-admin.php';
require_once SNAPFEED_PLUGIN_DIR . 'includes/class-snapfeed-dashboard.php';
require_once SNAPFEED_PLUGIN_DIR . 'includes/class-snapfeed-captcha.php';

// ── Activation / Deactivation ────────────────────────────────────────

register_activation_hook(__FILE__, function () {
    Snapfeed_DB::create_tables();
    Snapfeed_DB::schedule_cleanup();

    // Set default settings
    if (!get_option('snapfeed_settings')) {
        update_option('snapfeed_settings', Snapfeed_Admin::defaults());
    }
});

register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('snapfeed_daily_cleanup');
});

// ── Initialization ───────────────────────────────────────────────────

add_action('init', function () {
    // Schedule cleanup if not already scheduled
    if (!wp_next_scheduled('snapfeed_daily_cleanup')) {
        Snapfeed_DB::schedule_cleanup();
    }
});

add_action('rest_api_init', function () {
    Snapfeed_REST::register_routes();
});

add_action('wp_enqueue_scripts', function () {
    Snapfeed_Enqueue::enqueue_frontend();
});

add_action('admin_menu', function () {
    Snapfeed_Admin::register_menu();
    Snapfeed_Dashboard::register_menu();
});

add_action('admin_init', function () {
    Snapfeed_Admin::register_settings();
});

add_action('admin_enqueue_scripts', function ($hook) {
    Snapfeed_Dashboard::enqueue_admin_assets($hook);
});

// Data retention cron
add_action('snapfeed_daily_cleanup', function () {
    Snapfeed_DB::cleanup_old_events();
});
