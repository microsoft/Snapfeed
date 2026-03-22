<?php
/**
 * Uninstall Snapfeed — clean up all data on plugin deletion.
 *
 * This file runs when the plugin is deleted (not deactivated) from
 * the WordPress admin. It removes the database table and options.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

global $wpdb;

// Drop the events table
$table = $wpdb->prefix . 'snapfeed_events';
$wpdb->query("DROP TABLE IF EXISTS {$table}");

// Remove plugin options
delete_option('snapfeed_settings');

// Remove scheduled cron event
wp_clear_scheduled_hook('snapfeed_daily_cleanup');
