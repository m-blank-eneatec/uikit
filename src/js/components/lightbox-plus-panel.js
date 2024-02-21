import {
    $,
    addClass,
    append,
    attr,
    clamp,
    css,
    dimensions,
    fragment,
    getIndex,
    hasAttr,
    hasClass,
    hasTouch,
    html,
    observeViewportResize,
    on,
    once,
    pointerDown,
    pointerMove,
    removeAttr,
    removeClass,
    toggleClass,
    Transition,
    trigger,
} from 'uikit-util';
import Modal from '../mixin/modal';
import Slideshow from '../mixin/slideshow';
import { keyMap } from '../util/keys';
import Animations from './internal/lightbox-animations';
import Panzoom from '@panzoom/panzoom'
import { throttle } from '@github/mini-throttle';

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
        originalImageSrcThreshold: 2, // Once the user has zoomed in by this amount, the original image source will be set as the src attribute
        throttleDelay: 250, // Throttle expensive event handlers to prevent performance issues
        items: [],
        cls: 'uk-open',
        clsPage: 'uk-lightbox-plus-page',
        clsPanDisabled: 'uk-lightbox-plus-pan-disabled',
        clsSwipeDisabled: 'uk-lightbox-plus-swipe-disabled',
        clsImage: 'uk-lightbox-plus-image',
        selList: '.uk-lightbox-plus-items',
        attrItem: 'uk-lightbox-plus-item',
        selClose: '.uk-close-large',
        selCaption: '.uk-lightbox-plus-caption',
        pauseOnHover: false,
        velocity: 2,
        Animations,
        draggable: !hasTouch,
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

        zoomOptions({ clsPanDisabled }) {
            // Options for the Panzoom plugin
            return {
                startScale: 1,
                minScale: 1,
                maxScale: 3,
                cursor: 'move',
                animate: true,
                origin: '50% 50%',
                pinchAndPan: true,
                panOnlyWhenZoomed: true,
                excludeClass: clsPanDisabled
            };
        }
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
            name: 'shown',

            self: true,

            handler() {
                const onResizeHandler = () => {
                    if (!this.isToggled(this.$el)) {
                        return;
                    }

                    if (this.zoomImages) {
                        const slide = this.getSlide(this.index);
                        const img = $(`.${this.clsImage}`, slide);

                        if (img) {
                            scaleImgToSlide(slide, img);
                        }
                    }
                };

                observeViewportResize(throttle(onResizeHandler, this.throttleDelay));
            },
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
                    const slide = this.getSlide(this.index);

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
                const item = this.getItem();
                const slide = this.getSlide(item);
                const img = $(`.${this.clsImage}`, slide);

                html(this.caption, item.caption || '');

                if (!slide.childElementCount) {
                    // Preload this item first
                    this.loadItem(this.index);
                } else if (img) {
                    scaleImgToSlide(slide, img);
                }

                // Preload next and previous items as well after a short delay
                setTimeout(() => {
                    for (let j = 0; j <= this.preload; j++) {
                        this.loadItem(this.index + j);
                        this.loadItem(this.index - j);
                    }
                }, 300);
            },
        },

        {
            name: 'itemshown',

            handler() {
                setDraggableState(this);
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

            handler(_, __, slide) {
                if (slide) {
                    const img = $(`.${this.clsImage}`, slide);
                    if (img && this.zoomImages) {
                        initZoom(this, slide, img, this.zoomOptions);
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
                    const img = createEl('img', { src, srcset, class: this.clsImage, alt, ...attrs });
                    // Only listen to 'load' once, because we will replace the srcset later on
                    // and do not want to trigger the event handler again
                    once(img, 'load', () => this.setItem(item, img));
                    on(img, 'error', () => this.setError(item));

                    // Image
                } else if (
                    type === 'image' ||
                    src.match(/\.(avif|jpe?g|jfif|a?png|gif|svg|webp)($|\?)/i)
                ) {
                    const img = createEl('img', { src, class: this.clsImage, alt, ...attrs });
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

function listenForDoubleTap(el, cb, delay = 300) {
    let lastTapTime = 0;
    let isMoving = false;

    el.addEventListener('touchstart', (event) => {
        const currentTime = performance.now();
        const tapTime = currentTime - lastTapTime;
        lastTapTime = currentTime;

        if (tapTime < delay && tapTime > 0) {
            // Double tap detected
            if (!isMoving) {
                // Handle double tap action
                cb(event);
            }
        }
    });

    el.addEventListener('touchmove', (event) => {
        isMoving = (event.touches.length > 1);
    });
}

function scaleImgToSlide(slide, img) {
    // Reset the image to its original size and position
    css(img, 'height', 'auto');
    css(img, 'width', 'auto');

    // The image should fill out the parent slide without cropping or stretching
    const { width: imgWidth, height: imgHeight } = dimensions(img);
    const { width: slideWidth, height: slideHeight } = dimensions(slide);

    // Stop if the image has no dimensions yet
    if (imgWidth === 0 || imgHeight === 0) return;

    const imgAspectRatio = imgWidth / imgHeight;
    const slideAspectRatio = slideWidth / slideHeight;

    if (imgAspectRatio > slideAspectRatio) {
        css(img, 'width', '100%');
    } else {
        css(img, 'height', '100%');
    }
}

function setDraggableState(lightbox) {
    let draggable = lightbox.$props.draggable;;

    if (draggable) {
        const slide = lightbox.getSlide(lightbox.index);
        const img = $(`.${lightbox.clsImage}`, slide);

        if (img) {
            // Disable dragging the lightbox when the current image is zoomed in
            draggable = !hasClass(img, lightbox.clsSwipeDisabled);
        }
    }

    lightbox.draggable = draggable;
}

function initZoom(lightbox, slide, img, options) {
    if (img.tagName !== 'IMG') return;

    const hasSrcset = hasAttr(img, 'srcset');
    const originalSrc = attr(img, 'src');
    let hasOriginalSrc = !hasSrcset;
    let isWaitingForAnimation = false;

    // Initialize the Panzoom plugin
    const zoom = Panzoom(img, options);
    const zoomOptions = zoom.getOptions();

    function setOriginalSrc() {
        if (!hasOriginalSrc) {
            img.src = originalSrc;
            removeAttr(img, 'srcset');
            hasOriginalSrc = true;
        }
    }

    function onWheel(event) {
        // Enable zooming with mouse
        zoom.zoomWithWheel(event, { animate: zoomOptions.animate });
    }

    function onZoomIn() {
        zoom.zoomIn({ step: zoomOptions.step*2, animate: zoomOptions.animate });
    }

    function onZoomOut() {
        zoom.zoomOut({ step: zoomOptions.step*2, animate: zoomOptions.animate });
    }

    function onZoomReset() {
        zoom.reset({ animate: false });
    }

    function toggleImgZoomedCls(hasZoomed) {
        // Disable panning when the image is zoomed all the way out,
        // to allow the user to navigate to the next slide by swiping the image
        toggleClass(img, lightbox.clsPanDisabled, !hasZoomed);

        // Disable swiping when the image is zoomed in,
        // to allow the user to pan the image
        toggleClass(img, lightbox.clsSwipeDisabled, hasZoomed);

        // Set appropriate cursor style
        css(img, 'cursor', hasZoomed ? zoomOptions.cursor : 'default');

        setDraggableState(lightbox);
    }

    function panAndWait(toX, toY, animate = zoomOptions.animate) {
        // Prevent another zoom or pan event until the animation is complete
        // because calling pan() while the animation is running will cause the smooth animation to be interrupted
        if (!isWaitingForAnimation) {
            isWaitingForAnimation = true;
            zoom.setOptions({ disableZoom: true, disablePan: true });
            zoom.pan(toX, toY, { animate, force: true });

            // Reset settings after the animation is complete
            setTimeout(() => {
                isWaitingForAnimation = false;
                zoom.setOptions({ disableZoom: zoomOptions.disableZoom, disablePan: zoomOptions.disablePan });
            }, zoomOptions.duration);
        }
    }

    function clampPanToOffset(value, imgDimension, slideDimension, scale) {
        // Check if the image is filling the slide in the current axis (vertically or horizontally)
        const isFillingSlide = imgDimension >= slideDimension;
        if (isFillingSlide) {
            // Calculate the maximum offset on the current axis and clamp the value
            const maxOffset = ((imgDimension - slideDimension) / scale / 2);
            return clamp(value, -maxOffset, maxOffset);
        } else {
            // Center the image on the current axis to create even spacing on both sides
            return 0;
        }
    }

    function constrainPan(scale, x, y, animate = zoomOptions.animate) {
        // Get the dimensions of the image and the parent slide
        const { width: imgWidth, height: imgHeight } = dimensions(img);
        const { width: slideWidth, height: slideHeight } = dimensions(slide);

        // Clamp the x and y values
        const clampedX = clampPanToOffset(x, imgWidth, slideWidth, scale);
        const clampedY = clampPanToOffset(y, imgHeight, slideHeight, scale);

        if (x !== clampedX || y !== clampedY) {
            // Pan the image to the clamped position
            panAndWait(clampedX, clampedY, animate);
        }
    }

    function onPanZoom(event) {
        const { scale } = event.detail;
        const hasZoomed = (scale > 1);

        // Change src to high resolution image when zoomed in
        if ((scale === zoomOptions.maxScale) || (scale > lightbox.originalImageSrcThreshold)) {
            setOriginalSrc();
        }

        // Toggle the exclude class to the image when zoomed all the way out
        // to allow the user to navigate to the next slide by swiping the image
        toggleImgZoomedCls(hasZoomed);

        // Reset pan position back to the center
        if (!hasZoomed) {
            panAndWait(0, 0);
        }
    }

    function onPanZoomEnd(event) {
        const { scale, x, y } = event.detail;
        constrainPan(scale, x, y);
    }

    // Add listeners
    on(img, 'wheel', onWheel);
    on(img, 'panzoomzoom', throttle(onPanZoom, lightbox.throttleDelay));
    on(img, 'panzoomend', onPanZoomEnd);

    // Add listeners that are called by the lightbox component
    on(slide, 'zoom.in', onZoomIn);
    on(slide, 'zoom.out', onZoomOut);
    on(slide, 'zoom.reset', onZoomReset);

    // On double click / double tap zoom in
    on(img, 'dblclick', onZoomIn);
    listenForDoubleTap(img, onZoomIn);

    // Disable panning the image in the beginning
    // to allow the user to navigate to the next slide by swiping the image
    toggleImgZoomedCls(false);

    // Scale the image to the size of the slide
    scaleImgToSlide(slide, img);
}

function createEl(tag, attrs) {
    const el = fragment(`<${tag}>`);
    attr(el, attrs);
    return el;
}
