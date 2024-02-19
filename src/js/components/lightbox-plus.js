import { $$, assign, attr, data, findIndex, isElement, isTag, on, uniqueBy } from 'uikit-util';
import { parseOptions } from '../api/options';
import LightboxPlusPanel from './lightbox-plus-panel';

export default {
    install,

    props: { toggle: String },

    data: {
        toggle: 'a',
        swipeThreshold: 10 // same threshold as in src/js/mixin/slider-drag.js
    },

    computed: {
        toggles: ({ toggle }, $el) => $$(toggle, $el),
    },

    watch: {
        toggles(toggles) {
            this.hide();
            for (const toggle of toggles) {
                if (isTag(toggle, 'a')) {
                    attr(toggle, 'role', 'button');
                }
            }
        },
    },

    disconnected() {
        this.hide();
    },

    events: [
        {
            name: "mousedown",

            delegate() {
                return `${this.toggle}:not(.uk-disabled)`;
            },

            handler(e) {
                e.preventDefault();
                this.mouseDownPos = { x: e.clientX, y: e.clientY };
            }
        },

        {
            name: "mouseup",

            delegate() {
                return `${this.toggle}:not(.uk-disabled)`;
            },

            handler(e) {
                e.preventDefault();
                this.mouseUpPos = { x: e.clientX, y: e.clientY };
            }
        },

        {
            name: "click",

            delegate() {
                return `${this.toggle}:not(.uk-disabled)`;
            },

            handler(e) {
                e.preventDefault();

                // Try to differentiate between click and swipe (e.g. for slideshows)
                const swipeDistance = Math.hypot(
                    this.mouseUpPos.x - this.mouseDownPos.x,
                    this.mouseUpPos.y - this.mouseDownPos.y
                );

                if (swipeDistance >= this.swipeThreshold) {
                    // This action was a swipe, so don't open the lightbox
                    return;
                }

                this.show(e.current);
            }
        }
    ],

    methods: {
        show(index) {
            const items = uniqueBy(this.toggles.map(toItem), 'source');

            if (isElement(index)) {
                const { source } = toItem(index);
                index = findIndex(items, ({ source: src }) => source === src);
            }

            this.panel = this.panel || this.$create('lightboxPlusPanel', { ...this.$props, items });

            on(this.panel.$el, 'hidden', () => (this.panel = null));

            return this.panel.show(index);
        },

        hide() {
            return this.panel?.hide();
        },
    },
};

function install(UIkit, LightboxPlus) {
    if (!UIkit.LightboxPlusPanel) {
        UIkit.component('lightboxPlusPanel', LightboxPlusPanel);
    }

    assign(LightboxPlus.props, UIkit.component('lightboxPlusPanel').options.props);
}

function toItem(el) {
    const item = {};

    for (const attr of ['srcset', 'source', 'href', 'caption', 'type', 'poster', 'alt', 'attrs']) {
        item[attr === 'href' ? 'source' : attr] = data(el, attr);
    }

    item.attrs = parseOptions(item.attrs);

    return item;
}
