import {
    $,
    addClass,
    append,
    attr,
    css,
    fragment,
    getIndex,
    hasAttr,
    html,
    on,
    pointerDown,
    pointerMove,
    removeAttr,
    removeClass,
    Transition,
    trigger,
} from 'uikit-util';
import Modal from '../mixin/modal';
import Slideshow from '../mixin/slideshow';
import { keyMap } from '../util/keys';
import Animations from './internal/lightbox-animations';
import Panzoom from '@panzoom/panzoom'

export default {
    mixins: [Modal, Slideshow],

    functional: true,

    props: {
        delayControls: Number,
        preload: Number,
        videoAutoplay: Boolean,
        template: String,
        zoomImages: Boolean,
    },

    data: () => ({
        preload: 1,
        videoAutoplay: false,
        delayControls: 3000,
        zoomImages: true,
        items: [],
        cls: 'uk-open',
        clsPage: 'uk-lightbox-plus-page',
        clsImage: 'uk-lightbox-plus-image',
        selList: '.uk-lightbox-plus-items',
        attrItem: 'uk-lightbox-plus-item',
        selClose: '.uk-close-large',
        selCaption: '.uk-lightbox-plus-caption',
        pauseOnHover: false,
        velocity: 2,
        Animations,
        template: `<div class="uk-lightbox-plus uk-overflow-hidden">
                        <ul class="uk-lightbox-plus-items"></ul>
                        <div class="uk-lightbox-plus-toolbar uk-position-top uk-text-right uk-transition-slide-top uk-transition-opaque">
                            <button class="uk-lightbox-plus-toolbar-icon uk-close-large" type="button" uk-close></button>
                         </div>
                        <a class="uk-lightbox-plus-button uk-position-center-left uk-position-medium uk-transition-fade" href uk-slidenav-previous uk-lightbox-plus-item="previous"></a>
                        <a class="uk-lightbox-plus-button uk-position-center-right uk-position-medium uk-transition-fade" href uk-slidenav-next uk-lightbox-plus-item="next"></a>
                        <div class="uk-lightbox-plus-toolbar uk-lightbox-plus-caption uk-position-bottom uk-text-center uk-transition-slide-bottom uk-transition-opaque"></div>
                    </div>`,
    }),

    created() {
        const $el = $(this.template);
        const list = $(this.selList, $el);
        this.items.forEach(() => append(list, '<li>'));

        const close = $('[uk-close]', $el);
        const closeLabel = this.t('close');
        if (close && closeLabel) {
            close.dataset.i18n = JSON.stringify({ label: closeLabel });
        }

        this.$mount(append(this.container, $el));
    },

    computed: {
        caption: ({ selCaption }, $el) => $(selCaption, $el),
    },

    events: [
        {
            name: `${pointerMove} ${pointerDown} keydown`,

            handler: 'showControls',
        },

        {
            name: 'click',

            self: true,

            delegate() {
                return `${this.selList} > *`;
            },

            handler(e) {
                if (!e.defaultPrevented) {
                    this.hide();
                }
            },
        },

        {
            name: 'shown',

            self: true,

            handler: 'showControls',
        },

        {
            name: 'hide',

            self: true,

            handler() {
                this.hideControls();

                removeClass(this.slides, this.clsActive);
                Transition.stop(this.slides);
            },
        },

        {
            name: 'hidden',

            self: true,

            handler() {
                this.$destroy(true);
            },
        },

        {
            name: 'keydown',

            el: () => document,

            handler(event) {
                if (!this.isToggled(this.$el)) {
                    return;
                }

                const { key } = event;

                if (this.zoomImages) {
                    // Trigger a zoom event via keyboard
                    const item = this.getItem();
                    const slide = this.getSlide(item);

                    if (key === '+') {
                        trigger(slide, 'zoom.in');
                    } else if (key === '-') {
                        trigger(slide, 'zoom.out');
                    }
                }
            },
        },

        {
            name: 'keyup',

            el: () => document,

            handler({ keyCode }) {
                if (!this.isToggled(this.$el) || !this.draggable) {
                    return;
                }

                let i = -1;

                if (keyCode === keyMap.LEFT) {
                    i = 'previous';
                } else if (keyCode === keyMap.RIGHT) {
                    i = 'next';
                } else if (keyCode === keyMap.HOME) {
                    i = 0;
                } else if (keyCode === keyMap.END) {
                    i = 'last';
                }

                if (~i) {
                    this.show(i);
                }
            },
        },

        {
            name: 'beforeitemshow',

            handler(e) {
                if (this.isToggled()) {
                    return;
                }

                this.draggable = false;

                e.preventDefault();

                this.toggleElement(this.$el, true, false);

                this.animation = Animations['scale'];
                removeClass(e.target, this.clsActive);
                this.stack.splice(1, 0, this.index);
            },
        },

        {
            name: 'itemshow',

            handler() {
                html(this.caption, this.getItem().caption || '');

                // Preload this item first
                this.loadItem(this.index);

                // Preload next and previous items as well after a short delay
                const preload = function() {
                    for (let j = 0; j <= this.preload; j++) {
                        this.loadItem(this.index + j);
                        this.loadItem(this.index - j);
                    }
                };
                setTimeout(preload.bind(this), 300);
            },
        },

        {
            name: 'itemshown',

            handler() {
                this.draggable = this.$props.draggable;
            },
        },

        {
            name: 'itemhidden',

            handler({ target }) {
                // Trigger a reset zoom event
                if (this.zoomImages) {
                    trigger(target, 'zoom.reset');
                }
            },
        },

        {
            name: 'itemloaded',

            handler(_, __, slide, item) {
                if (slide && item) {
                    if (item.tagName === 'IMG' && this.zoomImages) {
                        initZoom(slide, item);
                    }
                }
            },
        },

        {
            name: 'itemload',

            async handler(_, item) {
                const { source: src, srcset, type, alt = '', poster, attrs = {} } = item;

                this.setItem(item, '<span uk-spinner></span>');

                if (!src) {
                    return;
                }

                let matches;
                const iframeAttrs = {
                    allowfullscreen: '',
                    style: 'max-width: 100%; box-sizing: border-box;',
                    'uk-responsive': '',
                    'uk-video': `${this.videoAutoplay}`,
                };

                // Image with srcset
                if (
                    srcset
                ) {
                    const img = createEl('img', { class: this.clsImage, src, srcset, alt, ...attrs });
                    // Only listen to 'load' once, because we will replace the srcset later on
                    // and do not want to trigger the event handler again
                    once(img, 'load', () => this.setItem(item, img));
                    on(img, 'error', () => this.setError(item));

                    // Image
                } else if (
                    type === 'image' ||
                    src.match(/\.(avif|jpe?g|jfif|a?png|gif|svg|webp)($|\?)/i)
                ) {
                    const img = createEl('img', { class: this.clsImage, src, alt, ...attrs });
                    on(img, 'load', () => this.setItem(item, img));
                    on(img, 'error', () => this.setError(item));

                    // Video
                } else if (type === 'video' || src.match(/\.(mp4|webm|ogv)($|\?)/i)) {
                    const video = createEl('video', {
                        src,
                        poster,
                        controls: '',
                        playsinline: '',
                        'uk-video': `${this.videoAutoplay}`,
                        ...attrs,
                    });

                    on(video, 'loadedmetadata', () => this.setItem(item, video));
                    on(video, 'error', () => this.setError(item));

                    // Iframe
                } else if (type === 'iframe' || src.match(/\.(html|php)($|\?)/i)) {
                    this.setItem(
                        item,
                        createEl('iframe', {
                            src,
                            allowfullscreen: '',
                            class: 'uk-lightbox-plus-iframe',
                            ...attrs,
                        }),
                    );

                    // YouTube
                } else if (
                    (matches = src.match(
                        /\/\/(?:.*?youtube(-nocookie)?\..*?(?:[?&]v=|\/shorts\/)|youtu\.be\/)([\w-]{11})[&?]?(.*)?/,
                    ))
                ) {
                    this.setItem(
                        item,
                        createEl('iframe', {
                            src: `https://www.youtube${matches[1] || ''}.com/embed/${matches[2]}${
                                matches[3] ? `?${matches[3]}` : ''
                            }`,
                            width: 1920,
                            height: 1080,
                            ...iframeAttrs,
                            ...attrs,
                        }),
                    );

                    // Vimeo
                } else if ((matches = src.match(/\/\/.*?vimeo\.[a-z]+\/(\d+)[&?]?(.*)?/))) {
                    try {
                        const { height, width } = await (
                            await fetch(
                                `https://vimeo.com/api/oembed.json?maxwidth=1920&url=${encodeURI(
                                    src,
                                )}`,
                                { credentials: 'omit' },
                            )
                        ).json();

                        this.setItem(
                            item,
                            createEl('iframe', {
                                src: `https://player.vimeo.com/video/${matches[1]}${
                                    matches[2] ? `?${matches[2]}` : ''
                                }`,
                                width,
                                height,
                                ...iframeAttrs,
                                ...attrs,
                            }),
                        );
                    } catch (e) {
                        this.setError(item);
                    }
                }
            },
        },
    ],

    methods: {
        loadItem(index = this.index) {
            const item = this.getItem(index);

            if (!this.getSlide(item).childElementCount) {
                trigger(this.$el, 'itemload', [item]);
            }
        },

        getItem(index = this.index) {
            return this.items[getIndex(index, this.slides)];
        },

        setItem(item, content) {
            const slide = this.getSlide(item);
            trigger(this.$el, 'itemloaded', [this, slide, html(slide, content)]);
        },

        getSlide(item) {
            return this.slides[this.items.indexOf(item)];
        },

        setError(item) {
            this.setItem(item, '<span uk-icon="icon: bolt; ratio: 2"></span>');
        },

        showControls() {
            clearTimeout(this.controlsTimer);
            this.controlsTimer = setTimeout(this.hideControls, this.delayControls);

            addClass(this.$el, 'uk-active', 'uk-transition-active');
        },

        hideControls() {
            removeClass(this.$el, 'uk-active', 'uk-transition-active');
        },
    },
};

function initZoom(slide, el) {
    if (el.tagName === 'IMG') {
        const hasSrcset = hasAttr(el, 'srcset');
        const originalSrc = attr(el, 'src');
        let hasOriginalSrc = !hasSrcset;
        let hasResetPan = false;

        // Initialize zoom plugin
        const zoom = Panzoom(el, {
            minScale: 1,
            maxScale: 3,
            cursor: 'default',
            animate: true,
            origin: '50% 50%',
            pinchAndPan: true,
            panOnlyWhenZoomed: true,
            setTransform: (elem, { scale, x, y }) => {
                css(elem, 'transform', `scale(${scale}) translate(${x}px, ${y}px)`);
            }
        });
        const zoomOptions = zoom.getOptions();

        function setOriginalSrc() {
            if (!hasOriginalSrc) {
                el.src = originalSrc;
                removeAttr(el, 'srcset');
                hasOriginalSrc = true;
            }
        }

        function onWheel(event) {
            // Enable zooming with mouse
            zoom.zoomWithWheel(event, { animate: zoomOptions.animate });
        }

        function onZoomReset() {
            zoom.reset({ animate: false });
        }

        function onZoomIn() {
            zoom.zoomIn({ animate: zoomOptions.animate });
        }

        function onZoomOut() {
            zoom.zoomOut({ animate: zoomOptions.animate });
        }

        function onPanZoomChange(event) {
            const { startScale, startX, startY } = zoomOptions;
            const { scale } = event.detail;

            // Change src to high resolution image when zoomed in
            const originalSrcThreshold = 2; // 2x zoom
            if ((scale === zoomOptions.maxScale) || ((scale / startScale) > originalSrcThreshold)) {
                setOriginalSrc();
            }

            // Reset pan position back to the center
            // and prevent another zoom or pan event
            // until the animation is complete
            if (event.detail.scale === startScale) {
                if (!hasResetPan) {
                    hasResetPan = true;
                    zoom.setOptions({ disableZoom: true });
                    zoom.pan(startX, startY, { animate: zoomOptions.animate, force: true });

                    // Reset settings after the animation is complete
                    setTimeout(function(){
                        hasResetPan = false;
                        zoom.setOptions({ disableZoom: zoomOptions.disableZoom });
                    }, zoomOptions.duration);
                }
            } else {
                hasResetPan = false;
            }
        }

        function addListenersAndInitializeZoom() {
            // Listen for wheel event to detect zooming
            on(el, 'wheel', onWheel);

            // Listen for the reset event and
            // keyboard events using the + and - keys
            on(slide, 'zoom.reset', onZoomReset);
            on(slide, 'zoom.in', onZoomIn);
            on(slide, 'zoom.out', onZoomOut);

            // Listen for panzoomchange event
            // to reset the pan position back to the center
            // when the image is zoomed all the way out
            on(el, 'panzoomchange', onPanZoomChange);
        }

        // Add listeners and initialize zoom
        addListenersAndInitializeZoom();
    }
}

function createEl(tag, attrs) {
    const el = fragment(`<${tag}>`);
    attr(el, attrs);
    return el;
}
