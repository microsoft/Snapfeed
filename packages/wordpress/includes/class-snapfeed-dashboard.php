<?php
/**
 * Snapfeed feedback dashboard.
 *
 * Provides a WP admin page for viewing sessions and events,
 * with screenshot lightbox and resolve workflow.
 */

defined('ABSPATH') || exit;

class Snapfeed_Dashboard {

    const PAGE_SLUG = 'snapfeed-dashboard';

    public static function register_menu(): void {
        add_menu_page(
            __('Snapfeed Feedback', 'snapfeed'),
            __('Snapfeed', 'snapfeed'),
            'edit_posts',
            self::PAGE_SLUG,
            [self::class, 'render_page'],
            'dashicons-feedback',
            30
        );
    }

    public static function enqueue_admin_assets(string $hook): void {
        if (strpos($hook, self::PAGE_SLUG) === false) {
            return;
        }

        wp_enqueue_style(
            'snapfeed-admin',
            SNAPFEED_PLUGIN_URL . 'assets/css/snapfeed-admin.css',
            [],
            SNAPFEED_VERSION
        );
    }

    public static function render_page(): void {
        if (!current_user_can('edit_posts')) return;

        $session_id = isset($_GET['session_id']) ? sanitize_text_field(wp_unslash($_GET['session_id'])) : null;

        echo '<div class="wrap">';
        echo '<h1>🔭 ' . esc_html__('Snapfeed Feedback', 'snapfeed') . '</h1>';

        if ($session_id) {
            self::render_event_detail($session_id);
        } else {
            self::render_sessions_list();
        }

        echo '</div>';
    }

    // ── Sessions List ────────────────────────────────────────────────

    private static function render_sessions_list(): void {
        $sessions = Snapfeed_DB::get_sessions(50);

        if (empty($sessions)) {
            echo '<div class="notice notice-info"><p>' . esc_html__('No feedback sessions yet. Snapfeed will start capturing events once visitors interact with your site.', 'snapfeed') . '</p></div>';
            return;
        }

        echo '<table class="wp-list-table widefat fixed striped">';
        echo '<thead><tr>';
        echo '<th>' . esc_html__('Session', 'snapfeed') . '</th>';
        echo '<th>' . esc_html__('First Event', 'snapfeed') . '</th>';
        echo '<th>' . esc_html__('Last Event', 'snapfeed') . '</th>';
        echo '<th>' . esc_html__('Events', 'snapfeed') . '</th>';
        echo '<th>' . esc_html__('Errors', 'snapfeed') . '</th>';
        echo '<th>' . esc_html__('Feedback', 'snapfeed') . '</th>';
        echo '</tr></thead>';
        echo '<tbody>';

        foreach ($sessions as $session) {
            $url = add_query_arg([
                'page'       => self::PAGE_SLUG,
                'session_id' => $session['session_id'],
            ], admin_url('admin.php'));

            $sid_short = substr($session['session_id'], 0, 12) . '…';

            echo '<tr>';
            echo '<td><a href="' . esc_url($url) . '"><code>' . esc_html($sid_short) . '</code></a></td>';
            echo '<td>' . esc_html($session['first_event']) . '</td>';
            echo '<td>' . esc_html($session['last_event']) . '</td>';
            echo '<td>' . absint($session['event_count']) . '</td>';
            echo '<td>' . (absint($session['error_count']) > 0
                ? '<span class="snapfeed-badge snapfeed-badge--error">' . absint($session['error_count']) . '</span>'
                : '0') . '</td>';
            echo '<td>' . (absint($session['feedback_count']) > 0
                ? '<span class="snapfeed-badge snapfeed-badge--feedback">' . absint($session['feedback_count']) . '</span>'
                : '0') . '</td>';
            echo '</tr>';
        }

        echo '</tbody></table>';
    }

    // ── Event Detail View ────────────────────────────────────────────

    private static function render_event_detail(string $session_id): void {
        $events = Snapfeed_DB::get_events([
            'session_id' => $session_id,
            'limit'      => 500,
        ]);

        // Back link
        $back_url = add_query_arg('page', self::PAGE_SLUG, admin_url('admin.php'));
        echo '<a href="' . esc_url($back_url) . '" class="page-title-action">&larr; ' . esc_html__('All Sessions', 'snapfeed') . '</a>';
        echo '<h2>' . esc_html__('Session:', 'snapfeed') . ' <code>' . esc_html($session_id) . '</code></h2>';

        if (empty($events)) {
            echo '<p>' . esc_html__('No events found for this session.', 'snapfeed') . '</p>';
            return;
        }

        // Category filter tabs
        $types = [];
        foreach ($events as $e) {
            $types[$e['event_type']] = ($types[$e['event_type']] ?? 0) + 1;
        }

        $filter = isset($_GET['filter']) ? sanitize_text_field(wp_unslash($_GET['filter'])) : '';
        echo '<div class="snapfeed-filters">';
        echo '<a href="' . esc_url(remove_query_arg('filter')) . '" class="button ' . ($filter === '' ? 'button-primary' : '') . '">'
            . esc_html__('All', 'snapfeed') . ' (' . count($events) . ')</a> ';
        foreach ($types as $type => $count) {
            $type_url = add_query_arg('filter', $type);
            $active   = ($filter === $type) ? 'button-primary' : '';
            $emoji    = self::type_emoji($type);
            echo '<a href="' . esc_url($type_url) . '" class="button ' . $active . '">'
                . $emoji . ' ' . esc_html($type) . ' (' . $count . ')</a> ';
        }
        echo '</div>';

        // Event timeline (reversed to show newest first → but events from DB are already DESC)
        echo '<div class="snapfeed-timeline">';
        foreach ($events as $event) {
            if ($filter && $event['event_type'] !== $filter) continue;

            $type  = $event['event_type'];
            $emoji = self::type_emoji($type);
            $is_feedback = ($type === 'feedback');
            $detail = $event['detail_json'] ? json_decode($event['detail_json'], true) : [];

            echo '<div class="snapfeed-event snapfeed-event--' . esc_attr($type) . '">';
            echo '<div class="snapfeed-event__header">';
            echo '<span class="snapfeed-event__type">' . $emoji . ' ' . esc_html($type) . '</span>';
            echo '<span class="snapfeed-event__time">' . esc_html($event['ts']) . '</span>';
            echo '<span class="snapfeed-event__seq">#' . absint($event['seq']) . '</span>';
            echo '</div>';

            // Target
            if (!empty($event['target'])) {
                echo '<div class="snapfeed-event__target">' . esc_html($event['target']) . '</div>';
            }

            // Page
            if (!empty($event['page'])) {
                echo '<div class="snapfeed-event__page">📄 ' . esc_html($event['page']) . '</div>';
            }

            // Feedback message
            if ($is_feedback && !empty($detail['message'])) {
                $category = $detail['category'] ?? 'other';
                echo '<div class="snapfeed-event__message">';
                echo '<strong>' . esc_html(ucfirst($category)) . ':</strong> ';
                echo esc_html($detail['message']);
                echo '</div>';
            }

            // Screenshot thumbnail
            if ($is_feedback) {
                $screenshot_url = rest_url('snapfeed/v1/events/' . absint($event['id']) . '/screenshot');
                echo '<div class="snapfeed-event__screenshot">';
                echo '<a href="' . esc_url($screenshot_url) . '" target="_blank" title="' . esc_attr__('View full screenshot', 'snapfeed') . '">';
                echo '<img src="' . esc_url($screenshot_url) . '" alt="Screenshot" loading="lazy" style="max-width:400px;max-height:250px;border:1px solid #d0d7de;border-radius:6px;cursor:zoom-in;">';
                echo '</a>';
                echo '</div>';
            }

            // Detail (collapsible)
            if (!empty($detail)) {
                // Network log
                if (!empty($detail['network_log'])) {
                    echo '<details class="snapfeed-event__detail"><summary>' . esc_html__('Network Log', 'snapfeed') . '</summary>';
                    echo '<pre>' . esc_html(wp_json_encode($detail['network_log'], JSON_PRETTY_PRINT)) . '</pre>';
                    echo '</details>';
                    unset($detail['network_log']);
                }

                // Replay data
                if (!empty($detail['replay_data'])) {
                    echo '<details class="snapfeed-event__detail"><summary>' . esc_html__('Session Replay', 'snapfeed') . '</summary>';
                    echo '<pre>' . esc_html(wp_json_encode($detail['replay_data'], JSON_PRETTY_PRINT)) . '</pre>';
                    echo '</details>';
                    unset($detail['replay_data']);
                }

                // Console errors
                if (!empty($detail['console_errors'])) {
                    echo '<details class="snapfeed-event__detail"><summary>' . esc_html__('Console Errors', 'snapfeed') . '</summary>';
                    echo '<pre>' . esc_html(wp_json_encode($detail['console_errors'], JSON_PRETTY_PRINT)) . '</pre>';
                    echo '</details>';
                    unset($detail['console_errors']);
                }

                // Remaining detail
                $remaining = array_diff_key($detail, array_flip(['message', 'category', 'screenshot']));
                if (!empty($remaining)) {
                    echo '<details class="snapfeed-event__detail"><summary>' . esc_html__('Event Detail', 'snapfeed') . '</summary>';
                    echo '<pre>' . esc_html(wp_json_encode($remaining, JSON_PRETTY_PRINT)) . '</pre>';
                    echo '</details>';
                }
            }

            // Resolve button (for feedback events)
            if ($is_feedback) {
                echo '<div class="snapfeed-event__actions">';
                echo '<form method="post" action="' . esc_url(rest_url('snapfeed/v1/events/' . absint($event['id']) . '/resolve')) . '" style="display:inline;">';
                echo '<input type="text" name="note" placeholder="' . esc_attr__('Resolution note…', 'snapfeed') . '" style="width:300px;">';
                echo ' <button type="submit" class="button button-small">' . esc_html__('Resolve', 'snapfeed') . '</button>';
                echo '</form>';
                echo '</div>';
            }

            echo '</div>'; // .snapfeed-event
        }
        echo '</div>'; // .snapfeed-timeline
    }

    private static function type_emoji(string $type): string {
        $map = [
            'session_start' => '🚀',
            'click'         => '🖱',
            'feedback'      => '💬',
            'navigation'    => '🧭',
            'error'         => '❌',
            'api_error'     => '⚠️',
            'network_error' => '🌐',
            'rage_click'    => '😤',
        ];
        return $map[$type] ?? '📋';
    }
}
