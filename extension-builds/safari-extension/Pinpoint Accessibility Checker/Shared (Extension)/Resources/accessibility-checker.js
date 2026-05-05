(function() {
    'use strict';
    
    // Prevent multiple instances
    if (window.uwAccessibilityChecker) {
        window.uwAccessibilityChecker.remove();
        return;
    }
    
            // Main accessibility checker object
        window.uwAccessibilityChecker = {
            version: '1.7.2', // Current version
            websiteUrl: 'https://pinpoint.heroicpixel.com/', // Main website URL
            legacyDomainUrl: 'https://althe3rd.github.io/Pinpoint/', // Legacy domain for transition
            issues: [],
            axeLoaded: false,
            checkedItems: new Set(), // Track manually verified items
            isMinimized: false, // Track minimized state
            shadowRoot: null, // Shadow DOM root
            isPickerActive: false, // Element picker mode state
            pickerHighlightEl: null,
            pickerTooltipEl: null,
            pickerDoneBtn: null,
            pickerTargetInput: null,
            _pickerMoveHandler: null,
            _pickerClickHandler: null,
            _pickerKeyHandler: null,
            _pickerScopeSeq: 0, // Counter for unique data-pinpoint-scope values
            heightPadding: 60, // Extra pixels added to content height to avoid tiny scrollbars and to give the bottom of the panel breathing room when there is room to grow
            scoreAnimationPlayed: false, // Run score animation only once
            // Visibility filters for list rendering
            filters: { errors: true, warnings: true, info: true },
        
        // Initialize the checker
        init: function() {
            // Stamp a fresh session ID for this panel instance. History
            // coalescing uses this to tell "click-spam within one session"
            // (coalesce) apart from "page reload + re-scan" (always append).
            this.sessionId = Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
            this.setupShadowDOM();
            this.rehydratePickerScopes();
            this.checkForUpdates();
            this.showLoadingPanel();
            this.loadAxeCore();
        },
        
        // Setup Shadow DOM container
        setupShadowDOM: function() {
            // Create container element
            const container = document.createElement('div');
            container.id = 'uw-a11y-container';
            document.body.appendChild(container);
            
            // Attach shadow root
            this.shadowRoot = container.attachShadow({ mode: 'open' });
            
            // Add global styles for highlight class (applied to main document)
            if (!document.getElementById('uw-a11y-global-styles')) {
                const globalStyle = document.createElement('style');
                globalStyle.id = 'uw-a11y-global-styles';
                globalStyle.textContent = `
                    /* The .uw-a11y-highlight rule is injected by applyHighlightStyles()
                       into a separate stylesheet so users can change it at runtime. */
                    /* Temporarily reveal hidden ancestors during highlight */
                    [data-uw-a11y-reveal] {
                        display: block !important;
                        visibility: visible !important;
                        opacity: 1 !important;
                        height: auto !important;
                        max-height: none !important;
                        clip: auto !important;
                        clip-path: none !important;
                        transform: none !important;
                        pointer-events: auto !important;
                        overflow: visible !important;
                    }
                    [hidden][data-uw-a11y-reveal] { display: block !important; }

                    /* Docked-right mode: shift the page so the panel doesn't cover content. */
                    body[data-uw-a11y-dock="right"] {
                        padding-right: 510px !important;
                        box-sizing: border-box;
                        transition: padding-right 0.3s ease;
                    }
                `;
                document.head.appendChild(globalStyle);
            }

            this.applyDockPosition(this.getDockPosition());
            this.applyHighlightStyles();
        },

        // ── Element highlight: user-customizable style + duration ───────────
        // Style presets are CSS rule bodies applied to .uw-a11y-highlight.
        // Duration is in milliseconds, or 0 meaning "stay until the user
        // selects another issue or clicks elsewhere on the page".
        getHighlightStylePresets: function() {
            return {
                classic: {
                    label: 'Classic — yellow fill, red border',
                    css: 'background: yellow !important; border: 2px solid red !important; box-shadow: 0 0 0 2px yellow !important;'
                },
                outline: {
                    label: 'Outline — red ring, no fill',
                    css: 'outline: 3px solid #dc3545 !important; outline-offset: 2px !important; box-shadow: 0 0 0 6px rgba(220,53,69,0.18) !important;'
                },
                glow: {
                    label: 'Glow — soft blue halo',
                    css: 'box-shadow: 0 0 0 3px rgba(59,130,246,0.85), 0 0 0 8px rgba(59,130,246,0.30) !important; outline: 1px solid rgba(59,130,246,0.95) !important; outline-offset: 1px !important;'
                },
                dashed: {
                    label: 'Dashed — animated dashed border',
                    css: 'outline: 2px dashed #dc3545 !important; outline-offset: 3px !important; animation: uw-a11y-highlight-dash 0.6s linear infinite !important;'
                },
                contrast: {
                    label: 'High contrast — black background, yellow ring',
                    css: 'background: #000 !important; color: #fff !important; box-shadow: 0 0 0 3px #ffeb3b, 0 0 0 6px #000 !important;'
                }
            };
        },

        getHighlightDurationOptions: function() {
            return [
                { value: 3000,  label: '3 seconds' },
                { value: 5000,  label: '5 seconds (default)' },
                { value: 10000, label: '10 seconds' },
                { value: 0,     label: 'Until I click away or pick another issue' }
            ];
        },

        getHighlightStyle: function() {
            const s = this.loadSettings();
            const presets = this.getHighlightStylePresets();
            return presets[s.highlightStyle] ? s.highlightStyle : 'classic';
        },

        setHighlightStyle: function(name) {
            const s = this.loadSettings();
            s.highlightStyle = name;
            this.saveSettings(s);
            this.applyHighlightStyles();
        },

        getHighlightDuration: function() {
            const s = this.loadSettings();
            const allowed = new Set(this.getHighlightDurationOptions().map(o => o.value));
            const v = (typeof s.highlightDuration === 'number') ? s.highlightDuration : 5000;
            return allowed.has(v) ? v : 5000;
        },

        setHighlightDuration: function(ms) {
            const s = this.loadSettings();
            s.highlightDuration = ms;
            this.saveSettings(s);
        },

        applyHighlightStyles: function() {
            const styleId = 'uw-a11y-highlight-styles';
            let el = document.getElementById(styleId);
            if (!el) {
                el = document.createElement('style');
                el.id = styleId;
                document.head.appendChild(el);
            }
            const preset = this.getHighlightStylePresets()[this.getHighlightStyle()];
            const css = preset ? preset.css : this.getHighlightStylePresets().classic.css;
            el.textContent =
                '@keyframes uw-a11y-highlight-dash { to { outline-offset: 8px; } }\n' +
                '.uw-a11y-highlight { ' + css + ' }';
        },

        getHighlightPosition: function() { /* unused — placeholder for future expansion */ return null; },

        getDockPosition: function() {
            const s = this.loadSettings();
            return s.dockPosition === 'right' ? 'right' : 'floating';
        },

        // 'guided' (default) shows a curated top-N list; 'advanced' shows full results.
        getDefaultResultsView: function() {
            const s = this.loadSettings();
            return s.defaultResultsView === 'advanced' ? 'advanced' : 'guided';
        },

        setDefaultResultsView: function(mode) {
            const s = this.loadSettings();
            s.defaultResultsView = mode === 'advanced' ? 'advanced' : 'guided';
            this.saveSettings(s);
        },

        setDockPosition: function(pos) {
            const s = this.loadSettings();
            s.dockPosition = pos === 'right' ? 'right' : 'floating';
            this.saveSettings(s);
            this.applyDockPosition(s.dockPosition);
        },

        applyDockPosition: function(pos) {
            const value = pos === 'right' ? 'right' : 'floating';
            if (value === 'right') {
                document.body.setAttribute('data-uw-a11y-dock', 'right');
            } else {
                document.body.removeAttribute('data-uw-a11y-dock');
            }
            const wrapper = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-wrapper');
            if (wrapper) {
                wrapper.classList.toggle('uw-a11y-docked-right', value === 'right');
                if (value === 'right') {
                    // Clear any drag-applied inline position so the dock CSS wins
                    wrapper.style.left = '';
                    wrapper.style.top = '';
                    wrapper.style.right = '';
                }
            }
        },
        
        // Show loading panel while axe-core loads
        showLoadingPanel: function() {
            this.shadowRoot.innerHTML = `
                ${this.getStyles()}
                <div id="uw-a11y-panel">
                    <div id="uw-a11y-header">
                        <div class="uw-a11y-title-container">
                            <svg xmlns="http://www.w3.org/2000/svg" class="uw-a11y-logo" viewBox="0 0 404 404" fill="none" aria-hidden="true"><g filter="url(#a)"><path fill="url(#b)" fill-rule="evenodd" d="M201 349c87.261 0 158-70.739 158-158S288.261 33 201 33 43 103.739 43 191s70.739 158 158 158Zm0 24c100.516 0 182-81.484 182-182S301.516 9 201 9 19 90.484 19 191s81.484 182 182 182Z" clip-rule="evenodd"/></g><g filter="url(#c)"><path fill="url(#d)" fill-rule="evenodd" d="M200.5 302c61.58 0 111.5-49.92 111.5-111.5S262.08 79 200.5 79 89 128.92 89 190.5 138.92 302 200.5 302Zm0 24c74.835 0 135.5-60.665 135.5-135.5C336 115.665 275.335 55 200.5 55 125.665 55 65 115.665 65 190.5 65 265.335 125.665 326 200.5 326Z" clip-rule="evenodd"/></g><defs><linearGradient id="b" x1="78.771" x2="324.572" y1="51.982" y2="313.9" gradientUnits="userSpaceOnUse"><stop stop-color="#7435CD"/><stop offset="1" stop-color="#33BFF1"/></linearGradient><linearGradient id="d" x1="109.5" x2="292.5" y1="87" y2="282" gradientUnits="userSpaceOnUse"><stop stop-color="#9A35CD"/><stop offset="1" stop-color="#33D1F1"/></linearGradient><filter id="a" width="403.2" height="403.2" x=".4" y=".4" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset dx="1" dy="11"/><feGaussianBlur stdDeviation="9.8"/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix values="0 0 0 0 0.0788033 0 0 0 0 0.401609 0 0 0 0 0.885817 0 0 0 0.17 0"/><feBlend in2="BackgroundImageFix" result="effect1_dropShadow_21_18"/><feBlend in="SourceGraphic" in2="effect1_dropShadow_21_18" result="shape"/></filter><filter id="c" width="310.2" height="310.2" x="46.4" y="46.4" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset dx="1" dy="11"/><feGaussianBlur stdDeviation="9.8"/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix values="0 0 0 0 0.0788033 0 0 0 0 0.670614 0 0 0 0 0.885817 0 0 0 0.17 0"/><feBlend in2="BackgroundImageFix" result="effect1_dropShadow_21_18"/><feBlend in="SourceGraphic" in2="effect1_dropShadow_21_18" result="shape"/></filter></defs></svg>
                            <h2 id="uw-a11y-title">Pinpoint Accessibility Checker</h2>
                        </div>
                        <button id="uw-a11y-close" aria-label="Close">✕</button>
                    </div>
                    <div id="uw-a11y-content">
                        <div style="text-align: center; padding: 2rem;">
                            <div class="uw-a11y-spinner"></div>
                            <p style="margin-top: 1rem;">Loading axe-core accessibility engine...</p>
                            <p style="font-size: 0.9rem; color: #666;">This may take a few seconds on first use.</p>
                        </div>
                    </div>
                </div>
            `;
            
            // Add event listeners
            this.shadowRoot.getElementById('uw-a11y-close').onclick = () => this.remove();
            this.applyDockPosition(this.getDockPosition());
        },

        // Load axe-core dynamically
        loadAxeCore: function() {
            // Check if axe is already loaded (pre-loaded by content script)
            if (window.axe) {
                console.log('✅ axe-core already available (pre-loaded by extension)');
                this.axeLoaded = true;
                this.runAxeChecks();
                return;
            }
            
            // Try to load axe-core from local bundle first (for browser extensions)
            this.tryLoadAxeFromExtension().then(success => {
                if (success) {
                    this.axeLoaded = true;
                    this.runAxeChecks();
                } else {
                    
                }
            }).catch(() => {
                
            });
        },

        // Try to load axe-core from extension bundle
        tryLoadAxeFromExtension: function() {
            return new Promise((resolve) => {
                // Check if we're running in a browser extension context
                if (!chrome || !chrome.runtime || !chrome.runtime.getURL) {
                    resolve(false);
                    return;
                }

                try {
                    const script = document.createElement('script');
                    script.src = chrome.runtime.getURL('axe-core.min.js');
                    script.onload = () => resolve(true);
                    script.onerror = () => resolve(false);
                    document.head.appendChild(script);
                } catch (error) {
                    resolve(false);
                }
            });
        },

        

        // Run axe-core accessibility checks
        runAxeChecks: function() {
            if (!window.axe) {
                this.showError('axe-core failed to load properly.');
                return;
            }
            
            // Configure axe with selected WCAG spec/level (defaults to 2.1 AA)
            const { wcagSpec, wcagLevel } = this.getSelectedWcag();
            const tags = this.buildWcagTags(wcagSpec, wcagLevel);
            const isAAA = (wcagLevel || '').toUpperCase() === 'AAA';
            const axeConfig = {
                rules: {
                    // Disable the region rule which often creates false positives
                    // for "Ensures all page content is contained by landmarks"
                    'region': { enabled: false },
                    // Disable AAA color contrast unless user asks for AAA
                    'color-contrast-enhanced': { enabled: isAAA },
                    // We replace axe's empty-heading rule with our own scan that
                    // also catches whitespace-only headings (e.g. <h2>&nbsp;</h2>)
                    // and always reports them as a violation, not manual review.
                    'empty-heading': { enabled: false }
                },
                runOnly: { type: 'tag', values: tags }
            };
            
            // Build context (with optional include scope and always-applied excludes)
            const context = this.buildAxeContext();

            // Run axe-core analysis with context (excluding configured selectors)
            window.axe.run(context, axeConfig, (err, results) => {
                if (err) {
                    this.showError('Error running accessibility analysis: ' + err.message);
                    return;
                }
                
                this.processAxeResults(results);
                // Always run our empty/whitespace heading scan (replaces axe's
                // empty-heading rule, which is disabled above).
                try {
                    this.runEmptyHeadingChecks();
                } catch (e) {
                    console.warn('Empty heading scan failed:', e);
                }
                // Run additional best-practices checks if enabled
                try {
                    if (this.isBestPracticesEnabled()) {
                        this.runBestPracticeChecks();
                    }
                } catch (e) {
                    // Don't let best-practice scan break the main flow
                    console.warn('Best-practices scan failed:', e);
                }
                this.displayResults();
            });
        },

        // Additional best-practices checks beyond axe rules
        runBestPracticeChecks: function() {
            // Respect include-scope: query only within scoped roots when set
            const includeSels = this.getEffectiveIncludeSelectors();
            const scopedRoots = includeSels.length > 0
                ? includeSels.flatMap(sel => { try { return Array.from(document.querySelectorAll(sel)); } catch(_) { return []; } })
                : [document];
            const scopedQueryAll = (sel) => scopedRoots.flatMap(root => { try { return Array.from(root.querySelectorAll(sel)); } catch(_) { return []; } });

            // Helper: compute an approximate accessible name for links/buttons
            const getAccessibleName = (el) => {
                if (!el) return '';
                // aria-label has highest precedence
                const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

                // aria-labelledby
                const labelledby = el.getAttribute && el.getAttribute('aria-labelledby');
                if (labelledby) {
                    const ids = labelledby.split(/\s+/);
                    const text = ids.map(id => {
                        const ref = document.getElementById(id);
                        return ref ? (ref.innerText || ref.textContent || '').trim() : '';
                    }).join(' ').trim();
                    if (text) return text;
                }

                // img alt inside link
                const img = el.querySelector && el.querySelector('img[alt]');
                if (img && img.getAttribute('alt') && img.getAttribute('alt').trim()) {
                    return img.getAttribute('alt').trim();
                }

                // input value for input buttons/submit
                if (el.tagName === 'INPUT') {
                    const type = (el.getAttribute('type') || '').toLowerCase();
                    const val = el.getAttribute('value');
                    if (val && val.trim() && ['button','submit','reset'].includes(type)) {
                        return val.trim();
                    }
                }

                // Fallback: text content
                const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                return text;
            };

            // Helper: basic visibility filter to reduce noise
            const isVisible = (el) => {
                try {
                    if (!el || !(el instanceof Element)) return false;
                    if (el.hidden) return false;
                    const style = window.getComputedStyle(el);
                    if (!style || style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
                    // Exclude our own UI container
                    if (el.closest && el.closest('#uw-a11y-container')) return false;
                    // Respect user/essential excludes for best-practice checks too
                    if (this.shouldExcludeElement && this.shouldExcludeElement(el)) return false;
                    return true;
                } catch (_) {
                    return true;
                }
            };

            // 1) Non-descriptive link text
            const genericPhrases = [
                'click here', 'here', 'learn more', 'read more', 'more', 'details',
                'this', 'this link', 'continue', 'link', 'info'
            ];
            const anchors = scopedQueryAll('a[href]');
            anchors.forEach(a => {
                if (!isVisible(a)) return;
                const name = getAccessibleName(a).toLowerCase();
                if (!name) return;
                const isGeneric = genericPhrases.includes(name);
                if (isGeneric) {
                    this.addIssue(
                        'info',
                        'Best Practice: Use contextual link text',
                        `The link text "${name}" is not descriptive out of context.`,
                        a,
                        'Use meaningful, specific link text that communicates the destination or action. For example, instead of <code>click here</code>, use <code>Download annual report (PDF)</code> or <code>Read more about financial aid</code>. You can also add context with <code>aria-label</code> when needed.',
                        'https://www.w3.org/WAI/GL/UNDERSTANDING-WCAG20/navigation-mechanisms-meaningful-sequence.html',
                        'minor',
                        ['best-practice', 'links'],
                        [
                            { label: 'Detected Text', value: name },
                            { label: 'Href', value: a.getAttribute('href') || '' }
                        ],
                        'bp-contextual-link-text'
                    );
                }
            });

            // 2) Multiple generic link texts that go to different destinations
            const mapByText = new Map();
            anchors.forEach(a => {
                if (!isVisible(a)) return;
                const name = getAccessibleName(a).toLowerCase();
                if (!genericPhrases.includes(name)) return; // only for generic texts
                const href = (a.getAttribute('href') || '').trim();
                if (!mapByText.has(name)) mapByText.set(name, new Set());
                mapByText.get(name).add(href);
            });
            mapByText.forEach((hrefs, text) => {
                if (hrefs.size > 1) {
                    // Flag once, reference examples
                    const examples = anchors.filter(a => genericPhrases.includes(getAccessibleName(a).toLowerCase()))
                        .slice(0, 3)
                        .map(a => ({ text: getAccessibleName(a), href: a.getAttribute('href') || '' }));
                    this.addIssue(
                        'info',
                        'Best Practice: Avoid repeated generic links',
                        `Found multiple "${text}" links pointing to different destinations.`,
                        null,
                        'Provide unique, contextual link text for each destination. For example, replace repeated <code>Read more</code> with <code>Read more about scholarships</code>, <code>Read more about housing</code>, etc.',
                        'https://www.w3.org/WAI/tutorials/page-structure/links/',
                        'minor',
                        ['best-practice', 'links'],
                        [
                            { label: 'Link Text', value: text },
                            { label: 'Unique Destinations', value: Array.from(hrefs).join(', ') },
                            { label: 'Examples (first 3)', value: examples.map(e => `${e.text} → ${e.href}`).join(' | ') }
                        ],
                        'bp-duplicate-generic-links'
                    );
                }
            });

            // 3) New tab/window behavior not communicated and missing rel security
            anchors.forEach(a => {
                if (!isVisible(a)) return;
                const target = a.getAttribute('target');
                if (target && target.toLowerCase() === '_blank') {
                    const name = getAccessibleName(a);
                    const nameLc = name.toLowerCase();
                    const mentionsNewTab = nameLc.includes('opens in new tab') || nameLc.includes('opens in a new tab') || nameLc.includes('(new tab)');
                    const rel = (a.getAttribute('rel') || '').toLowerCase();
                    const hasNoopener = rel.includes('noopener');
                    const hasNoreferrer = rel.includes('noreferrer');

                    if (!mentionsNewTab || !hasNoopener || !hasNoreferrer) {
                        const recommendations = [];
                        if (!mentionsNewTab) recommendations.push('Inform users the link opens in a new tab/window (e.g., include visually hidden text like <code><span class="sr-only">(opens in new tab)</span></code> or add to <code>aria-label</code>).');
                        if (!hasNoopener || !hasNoreferrer) recommendations.push('Add <code>rel="noopener noreferrer"</code> for security and privacy.');
                        this.addIssue(
                            'info',
                            'Best Practice: Communicate new-tab behavior',
                            'Link opens in a new tab/window but may not communicate this behavior or include recommended rel attributes.',
                            a,
                            recommendations.join(' '),
                            'https://www.w3.org/TR/WCAG20-TECHS/G201.html',
                            'minor',
                            ['best-practice', 'links'],
                            [
                                { label: 'Text', value: name },
                                { label: 'Href', value: a.getAttribute('href') || '' },
                                { label: 'Has rel', value: rel || '(none)' }
                            ],
                            'bp-new-tab-communication'
                        );
                    }
                }
            });

            // 4) Inputs using placeholder as the primary label (lack persistent label)
            const formControls = scopedQueryAll('input, textarea, select')
                .filter(el => {
                    const type = (el.getAttribute('type') || '').toLowerCase();
                    if (type === 'hidden') return false;
                    return true;
                });
            const hasAssociatedLabel = (el) => {
                if (!el || !(el instanceof Element)) return false;
                if (el.closest('label')) return true;
                const id = el.getAttribute('id');
                if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return true;
                if (el.hasAttribute('aria-label') && el.getAttribute('aria-label').trim()) return true;
                if (el.hasAttribute('aria-labelledby')) {
                    const ids = el.getAttribute('aria-labelledby').split(/\s+/);
                    const named = ids.map(i => document.getElementById(i)).filter(Boolean)
                        .map(n => (n.innerText || n.textContent || '').trim()).join(' ').trim();
                    if (named) return true;
                }
                return false;
            };
            formControls.forEach(el => {
                if (!isVisible(el)) return;
                const hasPlaceholder = el.hasAttribute('placeholder') && el.getAttribute('placeholder').trim();
                if (hasPlaceholder && !hasAssociatedLabel(el)) {
                    this.addIssue(
                        'info',
                        'Best Practice: Don\'t rely on placeholder as label',
                        'This form control appears to rely on placeholder text instead of a persistent label.',
                        el,
                        'Provide a visible, persistent <code><label></code> or an accessible name via <code>aria-label</code>/<code>aria-labelledby</code>. Placeholders should be hints, not primary labels, because they disappear on input and can reduce readability.',
                        'https://www.w3.org/WAI/tutorials/forms/labels/',
                        'minor',
                        ['best-practice', 'forms'],
                        [
                            { label: 'Control', value: el.tagName.toLowerCase() + (el.getAttribute('type') ? ` [type=${el.getAttribute('type')}]` : '') },
                            { label: 'Placeholder', value: el.getAttribute('placeholder') || '' }
                        ],
                        'bp-placeholder-only-label'
                    );
                }
            });

            // 5) Generic/unclear button text
            const buttonSelectors = 'button, input[type="button"], input[type="submit"], input[type="reset"], a[role="button"]';
            const buttons = scopedQueryAll(buttonSelectors);
            const genericButtonPhrases = [
                'submit','go','more','learn more','read more','click here','ok','yes','no','continue','next','previous','prev','send'
            ];
            buttons.forEach(btn => {
                if (!isVisible(btn)) return;
                const name = getAccessibleName(btn).trim();
                if (!name) return;
                if (genericButtonPhrases.includes(name.toLowerCase())) {
                    this.addIssue(
                        'info',
                        'Best Practice: Make button text specific',
                        `The button label "${name}" is generic and may be unclear.`,
                        btn,
                        'Use specific labels that describe the action, e.g., <code>Submit application</code>, <code>Search site</code>, or <code>Download report</code>.',
                        'https://www.w3.org/WAI/tutorials/forms/labels/#hints-and-instructions',
                        'minor',
                        ['best-practice', 'buttons'],
                        [ { label: 'Detected Text', value: name } ],
                        'bp-generic-button-text'
                    );
                }
            });

            // 6) Autoplaying media recommendations
            const autoplayMedia = scopedQueryAll('video[autoplay], audio[autoplay]');
            autoplayMedia.forEach(m => {
                if (!isVisible(m)) return;
                const hasControls = m.hasAttribute('controls');
                const isMuted = m.hasAttribute('muted');
                const label = m.tagName.toLowerCase();
                const recs = [];
                if (!hasControls) recs.push('Add <code>controls</code> so users can pause/stop.');
                if (!isMuted && m.tagName === 'VIDEO') recs.push('Avoid autoplay with sound; consider starting paused or muted.');
                recs.push('Respect user preference with <code>@media (prefers-reduced-motion: reduce)</code> and avoid distracting motion.');
                this.addIssue(
                    'info',
                    'Best Practice: Avoid autoplay without clear controls',
                    `${label} element autoplays. Autoplay can be disorienting and should generally be avoided.`,
                    m,
                    recs.join(' '),
                    'https://www.w3.org/WAI/WCAG21/Techniques/general/G19',
                    'minor',
                    ['best-practice', 'media'],
                    [ { label: 'Element', value: `<${label}>` }, { label: 'Controls', value: hasControls ? 'present' : 'missing' } ],
                    'bp-media-autoplay'
                );
            });

            // 7) Infinite or marquee-style animations
            // Simple tag checks first
            const marqueeLike = scopedQueryAll('marquee, blink');
            marqueeLike.forEach(el => {
                if (!isVisible(el)) return;
                this.addIssue(
                    'info',
                    'Best Practice: Avoid marquee/blink effects',
                    'Elements using marquee/blink effects can be distracting and hard to read.',
                    el,
                    'Replace with non-moving alternatives or provide user controls and respect <code>prefers-reduced-motion</code>.',
                    'https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html',
                    'minor',
                    ['best-practice', 'motion'],
                    [],
                    'bp-marquee-blink'
                );
            });
            // Computed-style animation scan (limited for performance)
            try {
                const allEls = scopedQueryAll('*');
                if (allEls.length <= 2500) {
                    allEls.forEach(el => {
                        if (!isVisible(el)) return;
                        const cs = getComputedStyle(el);
                        if (!cs) return;
                        const durations = (cs.animationDuration || '').split(',').map(s => (s || '').trim());
                        const iters = (cs.animationIterationCount || '').split(',').map(s => (s || '').trim());
                        const running = (cs.animationPlayState || '').split(',').some(s => s.trim() === 'running');
                        const hasDuration = durations.some(d => d && d !== '0s' && d !== '0ms');
                        const infinite = iters.some(n => n === 'infinite');
                        if (running && hasDuration && infinite) {
                            this.addIssue(
                                'info',
                                'Best Practice: Provide motion alternatives',
                                'Detected an element with continuous animation.',
                                el,
                                'Offer a way to pause/stop animation and respect <code>prefers-reduced-motion</code> to reduce or remove motion for users who prefer it.',
                                'https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html',
                                'minor',
                                ['best-practice', 'motion'],
                                [],
                                'bp-infinite-animation'
                            );
                        }
                    });
                }
            } catch (_) { /* ignore animation scan errors */ }

            // 8) File-type link labeling (PDF, docs, etc.)
            const fileExts = ['.pdf','.doc','.docx','.ppt','.pptx','.xls','.xlsx','.zip'];
            anchors.forEach(a => {
                if (!isVisible(a)) return;
                const href = (a.getAttribute('href') || '').toLowerCase();
                const name = getAccessibleName(a).toLowerCase();
                const matched = fileExts.find(ext => href.endsWith(ext));
                if (matched && name && !name.includes(matched.replace('.', ''))) {
                    this.addIssue(
                        'info',
                        'Best Practice: Indicate file type in link',
                        `This link points to a ${matched.toUpperCase()} file, but the link text may not indicate the file type.`,
                        a,
                        'Include the file type (and optionally size) in the link text, e.g., <code>Annual Report (PDF)</code>.',
                        'https://www.w3.org/WAI/tips/writing/#inform-users-about-what-to-expect',
                        'minor',
                        ['best-practice', 'links'],
                        [ { label: 'Href', value: href } ],
                        'bp-filetype-link-label'
                    );
                }
            });

            // 9) Buttons whose accessible name contains only emoji (no real text).
            // axe-core passes these because they have a non-empty name, but emoji alone
            // are ambiguous: their meaning varies by platform, and screen readers
            // announce them as long Unicode descriptions ("thumbs up sign") rather than
            // a clear action. A visible text label or a descriptive aria-label is needed.
            const stripEmojiComponents = (str) => {
                try {
                    return str
                        .replace(/\p{Emoji_Presentation}/gu, '') // base emoji
                        .replace(/[\u{FE00}-\u{FE0F}]/gu, '')    // variation selectors
                        .replace(/\u{200D}/gu, '')                // zero-width joiner
                        .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')  // skin-tone modifiers
                        .replace(/[\u{E0020}-\u{E007F}]/gu, '')  // tag characters (flags)
                        .trim();
                } catch (_) {
                    // Regex with Unicode property escapes unsupported (very old engine)
                    return str;
                }
            };

            buttons.forEach(btn => {
                if (!isVisible(btn)) return;
                const name = getAccessibleName(btn).trim();
                if (!name) return; // empty labels already caught by axe-core button-name rule

                let hasEmoji = false;
                try { hasEmoji = /\p{Emoji_Presentation}/u.test(name); } catch (_) { return; }
                if (!hasEmoji) return;

                const stripped = stripEmojiComponents(name);
                // If no word characters remain after stripping emoji, it's emoji-only
                const hasRealText = /\w/.test(stripped);
                if (!hasRealText) {
                    this.addIssue(
                        'info',
                        'Best Practice: Add text label to emoji-only button',
                        `Button's accessible name appears to be emoji only: "${name}". Emoji labels are ambiguous and announced inconsistently across screen readers.`,
                        btn,
                        'Add a visible text label alongside the emoji, or use <code>aria-label</code> with a clear, action-oriented description — e.g. <code>&lt;button aria-label="Approve"&gt;👍&lt;/button&gt;</code>. Avoid relying on emoji alone to convey purpose.',
                        'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
                        'moderate',
                        ['best-practice', 'buttons'],
                        [
                            { label: 'Detected Label', value: name },
                            { label: 'Stripped (no emoji)', value: stripped || '(empty)' }
                        ],
                        'bp-emoji-only-button'
                    );
                }
            });
        },

        // Scan for headings with no real text — either truly empty
        // (<h2></h2>) or whitespace-only (<h2>&nbsp;</h2>, <h2>   </h2>).
        // Replaces axe-core's empty-heading rule (disabled in axeConfig)
        // because axe treats U+00A0 as content and sometimes reports
        // empty-heading as manual review instead of a violation. Both
        // forms break the page outline and screen-reader navigation, so
        // we always report them as errors.
        runEmptyHeadingChecks: function() {
            const includeSels = this.getEffectiveIncludeSelectors();
            const scopedRoots = includeSels.length > 0
                ? includeSels.flatMap(sel => { try { return Array.from(document.querySelectorAll(sel)); } catch(_) { return []; } })
                : [document];
            const scopedQueryAll = (sel) => scopedRoots.flatMap(root => { try { return Array.from(root.querySelectorAll(sel)); } catch(_) { return []; } });

            const isVisible = (el) => {
                try {
                    if (!el || !(el instanceof Element)) return false;
                    if (el.hidden) return false;
                    const style = window.getComputedStyle(el);
                    if (!style || style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
                    if (el.closest && el.closest('#uw-a11y-container')) return false;
                    if (this.shouldExcludeElement && this.shouldExcludeElement(el)) return false;
                    return true;
                } catch (_) {
                    return true;
                }
            };

            // Strip standard whitespace plus non-breaking space and zero-width chars
            const stripWhitespace = (s) => (s || '').replace(/[\s ​-‍﻿]/g, '');

            const headings = scopedQueryAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
            headings.forEach(h => {
                if (!isVisible(h)) return;

                // If an ARIA label provides real text, the heading has an accessible name.
                const ariaLabel = stripWhitespace(h.getAttribute('aria-label') || '');
                if (ariaLabel) return;
                if (h.hasAttribute('aria-labelledby')) {
                    const ids = h.getAttribute('aria-labelledby').split(/\s+/).filter(Boolean);
                    const labelText = stripWhitespace(ids.map(id => {
                        const ref = document.getElementById(id);
                        return ref ? (ref.innerText || ref.textContent || '') : '';
                    }).join(''));
                    if (labelText) return;
                }

                // Image alt inside the heading counts as text content.
                const imgWithAlt = h.querySelector('img[alt]');
                if (imgWithAlt && imgWithAlt.getAttribute('alt').trim()) return;

                const raw = h.textContent || '';
                const stripped = stripWhitespace(raw);
                if (stripped.length > 0) return;

                const tag = h.tagName.toLowerCase();
                const isTrulyEmpty = raw.length === 0;
                const codes = Array.from(raw).map(c =>
                    'U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')
                ).join(' ');

                const title = isTrulyEmpty
                    ? 'Heading is empty'
                    : 'Heading contains only whitespace';
                const description = isTrulyEmpty
                    ? 'This <' + tag + '> has no content. Screen readers will announce a heading with no text, breaking the page outline.'
                    : 'This <' + tag + '> contains only whitespace (e.g. spaces or <code>&amp;nbsp;</code>) and has no readable text. Screen readers will announce a heading with no content, breaking the page outline.';
                const recommendation = isTrulyEmpty
                    ? 'Add meaningful text to the heading, or remove the heading element if it is decorative.'
                    : 'Add meaningful text to the heading, or remove the heading element if it is decorative or used only for spacing. Avoid using <code>&amp;nbsp;</code> to create vertical space — use CSS margins or padding instead.';

                const detailedInfo = [{ label: 'Element', value: '<' + tag + '>' }];
                if (!isTrulyEmpty) {
                    detailedInfo.push({ label: 'Character Codes', value: codes });
                }

                this.addIssue(
                    'error',
                    title,
                    description,
                    h,
                    recommendation,
                    'https://dequeuniversity.com/rules/axe/4.10/empty-heading',
                    'minor',
                    ['cat.name-role-value', 'best-practice', 'wcag2a', 'wcag131'],
                    detailedInfo,
                    'empty-heading'
                );
            });
        },

        // Process axe-core results into our format
        processAxeResults: function(results) {
            this.issues = [];

            // Load previously checked items for this session
            this.loadCheckedItems();

            // Build scope filter — checks if an element is within the include selectors
            const isInScope = this.buildScopeFilter();

            // Process violations (errors)
            results.violations.forEach(violation => {
                violation.nodes.forEach(node => {
                    // Skip if this node is part of our accessibility checker UI
                    if (this.isOwnUIElement(node)) {
                        return;
                    }

                    // Skip if outside the user's scan scope
                    if (!isInScope(this.getElementFromNode(node))) {
                        return;
                    }

                    // Check if this is a contrast violation that can be auto-resolved
                    const shouldSkipViolation = this.shouldSkipContrastViolation(violation, node);

                    if (shouldSkipViolation) {
                        // Skip entirely - no need to show resolved contrast violations to user
                        return;
                    }
                    
                                    this.addIssue(
                    'error',
                    violation.description,
                    this.buildDescription(violation, node),
                    this.getElementFromNode(node),
                    this.buildRecommendation(violation, node, 'error'),
                    violation.helpUrl,
                    violation.impact || 'serious',
                    violation.tags,
                    this.buildDetailedInfo(violation, node),
                    violation.id
                );
                });
            });
            
                    // Process incomplete items (warnings) with unique IDs for tracking
        results.incomplete.forEach((incomplete, incompleteIndex) => {
            incomplete.nodes.forEach((node, nodeIndex) => {
                // Skip if this node is part of our accessibility checker UI
                if (this.isOwnUIElement(node)) {
                    return;
                }

                // Skip if outside the user's scan scope
                if (!isInScope(this.getElementFromNode(node))) {
                    return;
                }

                // Check if this is a contrast issue that can be auto-resolved (passes)
                const shouldSkipManualReview = this.shouldSkipContrastManualReview(incomplete, node);
                if (shouldSkipManualReview) {
                    return;
                }

                // Check if this contrast issue can be escalated to a definite error (fails)
                const shouldEscalate = this.shouldEscalateContrastToError(incomplete, node);
                if (shouldEscalate) {
                    this.addIssue(
                        'error',
                        incomplete.description,
                        this.buildDescription(incomplete, node),
                        this.getElementFromNode(node),
                        this.buildRecommendation(incomplete, node, 'error'),
                        incomplete.helpUrl,
                        'serious',
                        incomplete.tags,
                        this.buildDetailedInfo(incomplete, node),
                        incomplete.id + '-confirmed'
                    );
                    // Mark as escalated so the score calculator can count it.
                    // Escalated issues come from axe incomplete (not violations), so they
                    // are invisible to the violations-based score loop without this flag.
                    this.issues[this.issues.length - 1].escalated = true;
                    return;
                }

                const uniqueId = `incomplete-${incompleteIndex}-${nodeIndex}`;
                this.addIssue(
                    'warning',
                    incomplete.description,
                    'Manual review needed: ' + this.buildDescription(incomplete, node),
                    this.getElementFromNode(node),
                    this.buildRecommendation(incomplete, node, 'warning'),
                    incomplete.helpUrl,
                    incomplete.impact || 'moderate',
                    incomplete.tags,
                    this.buildDetailedInfo(incomplete, node),
                    incomplete.id
                );
                // Store the unique ID for this manual review item
                this.issues[this.issues.length - 1].uniqueId = uniqueId;
            });
        });
            
            // Store the original results for score recalculation
            this.originalAxeResults = results;

            // Create filtered results for accurate scoring:
            // exclude own UI elements AND apply the include-scope filter
            const filteredResults = {
                ...results,
                violations: results.violations.map(violation => ({
                    ...violation,
                    nodes: violation.nodes.filter(node =>
                        !this.isOwnUIElement(node) && isInScope(this.getElementFromNode(node))
                    )
                })).filter(violation => violation.nodes.length > 0),
                incomplete: results.incomplete.map(incomplete => ({
                    ...incomplete,
                    nodes: incomplete.nodes.filter(node =>
                        !this.isOwnUIElement(node) && isInScope(this.getElementFromNode(node))
                    )
                })).filter(incomplete => incomplete.nodes.length > 0)
            };
            
            // Add summary information and calculate score using filtered results
            this.axeResults = {
                url: results.url,
                timestamp: results.timestamp,
                toolOptions: results.toolOptions,
                violations: filteredResults.violations.length,
                passes: results.passes.length, // Passes don't need filtering
                incomplete: filteredResults.incomplete.length,
                inapplicable: results.inapplicable.length, // Inapplicable don't need filtering
                score: this.calculateAccessibilityScore(filteredResults)
            };
            
            // Store filtered results for score recalculation
            this.filteredAxeResults = filteredResults;
        },
        
        // Build description from axe result
        buildDescription: function(rule, node) {
            let description = rule.help || rule.description;
            
            if (node.failureSummary) {
                description += '\n\nDetails: ' + node.failureSummary;
            }
            
            if (node.html) {
                description += '\n\nElement: ' + node.html.substring(0, 100);
                if (node.html.length > 100) description += '...';
            }
            
            return description;
        },
        
        // Build recommendation from axe result
        buildRecommendation: function(rule, node, issueType = 'error') {
            const ruleId = rule.id;
            let recommendationText = '';
            
            if (issueType === 'warning') {
                // Manual review items need verification guidance, not fixing instructions
                const manualReviewRecommendations = this.getManualReviewRecommendations();
                if (manualReviewRecommendations[ruleId]) {
                    const rec = manualReviewRecommendations[ruleId];
                    recommendationText = typeof rec === 'function' ? rec(node, rule) : rec;
                } else {
                    // Use default manual review guidance
                    const defaultRec = manualReviewRecommendations['default'];
                    recommendationText = defaultRec(node, rule);
                }
            } else {
                // Violations need fixing instructions
                const recommendations = this.getActionableRecommendations();
                if (recommendations[ruleId]) {
                    const rec = recommendations[ruleId];
                    recommendationText = typeof rec === 'function' ? rec(node, rule) : rec;
                } else {
                    recommendationText = rule.help || 'Please refer to the help documentation for specific guidance on fixing this issue.';
                }
            }
            
            // Format the recommendation with proper code escaping
            return this.formatRecommendation(recommendationText);
        },

        // Detect the CMS / site builder powering the current page so we can
        // tailor "How to fix" advice. Cached for the session — the platform
        // doesn't change while the panel is open.
        detectPlatform: function() {
            if (this._platform !== undefined) return this._platform;
            let p = null;
            try {
                const gen = document.querySelector('meta[name="generator"]');
                const genContent = ((gen && gen.getAttribute('content')) || '').toLowerCase();
                if (genContent.includes('wordpress')) p = 'wordpress';
                else if (genContent.includes('drupal')) p = 'drupal';
                else if (genContent.includes('squarespace')) p = 'squarespace';
                else if (genContent.includes('wix.com') || genContent.includes('wix ')) p = 'wix';
                else if (genContent.includes('webflow')) p = 'webflow';
                else if (genContent.includes('shopify')) p = 'shopify';
                else if (genContent.includes('hubspot')) p = 'hubspot';

                if (!p) {
                    if (window.wp || document.getElementById('wpadminbar') ||
                        document.querySelector('link[href*="wp-content"], script[src*="wp-content"], script[src*="wp-includes"], link[href*="/wp-json/"]')) p = 'wordpress';
                    else if (window.Drupal || (document.body && document.body.classList && [...document.body.classList].some(c => c.startsWith('node-type-') || c === 'drupal' || c.startsWith('path-'))) ||
                        document.querySelector('script[src*="/sites/default/files/"], link[href*="/sites/default/files/"], script[src*="/sites/all/"], script[src*="/core/misc/drupal"]')) p = 'drupal';
                    else if (document.querySelector('script[src*="static.squarespace.com"], link[href*="static.squarespace.com"], img[src*="squarespace-cdn.com"]')) p = 'squarespace';
                    else if (window.Shopify || document.querySelector('script[src*="cdn.shopify.com"], link[href*="cdn.shopify.com"]')) p = 'shopify';
                    else if (document.querySelector('script[src*="wixstatic.com"], img[src*="wixstatic.com"], script[src*="parastorage.com"]')) p = 'wix';
                    else if (document.querySelector('html[data-wf-page], html[data-wf-site], script[src*="webflow.com"], script[src*="webflow.io"]')) p = 'webflow';
                    else if (document.querySelector('script[src*="js.hs-scripts.com"], script[src*="js.hubspot.com"], script[src*="hs-analytics.net"]')) p = 'hubspot';
                }
            } catch (_) { /* best-effort */ }
            this._platform = p;
            return p;
        },

        // Friendly label for a detected platform.
        getPlatformLabel: function(platform) {
            const p = platform || this.detectPlatform();
            const labels = {
                wordpress: 'WordPress',
                drupal: 'Drupal',
                squarespace: 'Squarespace',
                wix: 'Wix',
                shopify: 'Shopify',
                webflow: 'Webflow',
                hubspot: 'HubSpot'
            };
            return labels[p] || '';
        },

        // Platform-specific "where to fix this" guidance, keyed by axe rule
        // ID (or our `bp-*` IDs). Tips intentionally reference the editor /
        // admin path, not code, since that's the value-add over the generic
        // recommendation. Returns '' when no tip is defined for the
        // current platform × rule combination.
        getPlatformTip: function(ruleId) {
            const platform = this.detectPlatform();
            if (!platform || !ruleId) return '';
            const baseId = String(ruleId).toLowerCase().replace(/-(error|warning|info)$/, '');
            const tips = {
                wordpress: {
                    'image-alt': 'Open the page in the WordPress editor, click the image block, and fill the <strong>Alternative text</strong> field in the Block sidebar. For images in the Media Library, edit the attachment to update its alt text everywhere it\'s used.',
                    'input-image-alt': 'In the form plugin or block, edit the image-input field and add alt text via the field settings.',
                    'role-img-alt': 'If the image was added via a Custom HTML block, edit the block and add an <code>alt</code> attribute (or <code>aria-label</code> for SVGs).',
                    'svg-img-alt': 'If the SVG was inserted via Custom HTML or a theme template, add a <code>&lt;title&gt;</code> child or <code>aria-label</code> to give it a name.',
                    'link-name': 'Edit the page in the block editor, click the link, and use the link toolbar to replace generic phrases like "click here" with descriptive wording.',
                    'empty-heading': 'In the block editor, click the empty heading block and either type heading text or use the block toolbar to convert it to a Paragraph or Spacer block.',
                    'heading-order': 'Open List View (top-left toolbar) to see the heading outline, then use each heading block\'s toolbar to change its level (H1–H6).',
                    'page-has-heading-one': 'Most themes render the post / page title as the H1. Confirm the title is set, or add an H1 heading block at the top of the content.',
                    'document-title': 'Set the page title in the editor, or configure your SEO plugin (Yoast, Rank Math, AIOSEO) to provide a title tag.',
                    'html-has-lang': 'Edit <strong>Settings → General → Site Language</strong>; the theme\'s header.php should already use <code>language_attributes()</code>.',
                    'color-contrast': 'Adjust colors in <strong>Appearance → Editor → Styles</strong> (block themes), the Customizer (classic themes), or the block\'s color settings. If your theme uses theme.json, edit the color palette there.',
                    'meta-viewport': 'This is set by the theme. Edit the theme\'s header.php (or switch themes) to remove <code>user-scalable=no</code> / <code>maximum-scale</code> from the viewport meta.',
                    'video-caption': 'Re-host the video on YouTube/Vimeo with captions enabled and embed via the Video / YouTube block. The native Video block does not provide a captions UI.',
                    'frame-title': 'When embedding via a Custom HTML block, add <code>title="..."</code> to the <code>&lt;iframe&gt;</code>.',
                    'label': 'In the form plugin (Gravity Forms, Contact Form 7, Forminator, etc.), edit the field and ensure the visible Label is set, not just a placeholder.'
                },
                drupal: {
                    'image-alt': 'Edit the node, open the image field, and fill the <strong>Alternative text</strong>. For media library images, edit the media entity so every reference inherits the alt text.',
                    'input-image-alt': 'Edit the form (Webform / form_alter) and add alt text to the image-input field settings.',
                    'svg-img-alt': 'If the SVG is in a CKEditor body, switch to source view and add <code>aria-label</code> or a <code>&lt;title&gt;</code> child.',
                    'link-name': 'Edit the node or block where the link lives and use the CKEditor link dialog to rewrite the link text.',
                    'empty-heading': 'In CKEditor, place the cursor in the empty heading and either type content or use the Format dropdown to convert it back to Paragraph.',
                    'heading-order': 'Use the CKEditor Format dropdown to adjust heading levels in the body field, or restructure block placement in the layout.',
                    'document-title': 'Confirm the node has a Title, and review the <strong>Metatag</strong> module configuration for the content type.',
                    'html-has-lang': 'Enable the core <strong>Language</strong> module and configure <strong>Configuration → Regional and language → Languages</strong>.',
                    'color-contrast': 'Adjust theme color tokens in your subtheme\'s CSS / theme settings (Olivero, Claro, and Gin all expose color variables).',
                    'video-caption': 'When adding the video via the Media library, attach a captions / subtitle file to the media entity so it travels with every reference.',
                    'frame-title': 'In CKEditor source view (or via a custom embed plugin), add <code>title="..."</code> to the <code>&lt;iframe&gt;</code>.',
                    'label': 'In the form (Webform or Form API), set the field\'s <strong>Title</strong> and either show it or set its display to "invisible" rather than removing the label.'
                },
                squarespace: {
                    'image-alt': 'Click the image block, open <strong>Edit</strong>, and fill the <strong>Image alt text</strong> field. (When "Display caption" is on, the caption can also serve as alt.)',
                    'link-name': 'Click the text or button block, edit the link, and replace generic phrases with descriptive text.',
                    'empty-heading': 'Click the heading block in the editor and either type content or change the dropdown back to Paragraph / Normal.',
                    'heading-order': 'Click each heading block and pick H1–H4 from the format dropdown so the outline reads in order.',
                    'color-contrast': 'Open <strong>Site Styles → Colors</strong> to adjust the palette, or override section colors per page from the section\'s color theme.',
                    'document-title': 'Open <strong>Pages → page settings → SEO</strong> and set the SEO Title.',
                    'html-has-lang': 'Open <strong>Settings → Language & Region</strong> and confirm the site language is set.',
                    'video-caption': 'Host the video on YouTube/Vimeo with captions enabled and embed it; Squarespace\'s native video block does not surface a captions UI.'
                },
                wix: {
                    'image-alt': 'Click the image, choose <strong>Settings</strong> → <strong>"What\'s in the photo? Tell Google"</strong>, and fill in the alt text.',
                    'link-name': 'Click the text or button, choose <strong>Edit Link</strong>, and rewrite the link text or button label.',
                    'empty-heading': 'Click the empty heading and either type content or change the text style back to Paragraph in the text editor.',
                    'color-contrast': 'Adjust colors via the element\'s Design panel or your site\'s <strong>Theme Manager</strong> (Color & Text Themes).',
                    'document-title': 'Open <strong>Page Settings → SEO Basics</strong> and set the title tag.',
                    'html-has-lang': 'Open <strong>Settings → Language & Region</strong> to set the primary site language.'
                },
                shopify: {
                    'image-alt': 'Edit the product, collection, or page, click the image, and fill the <strong>Image alt text</strong> field. For theme-level images, edit them in <strong>Online Store → Themes → Customize</strong>.',
                    'link-name': 'Edit the page or section in the theme editor and rewrite the link text in the rich-text or link field.',
                    'color-contrast': 'Open <strong>Online Store → Themes → Customize → Theme settings → Colors</strong> to adjust the palette.',
                    'document-title': 'Edit the page / product\'s <strong>Search engine listing</strong> section to set the title.',
                    'video-caption': 'Upload a captions track via the video metafield, or embed via YouTube/Vimeo with captions on.',
                    'label': 'In the form section settings, ensure each field\'s <strong>Label</strong> is set and visible (don\'t rely on placeholder text alone).'
                },
                webflow: {
                    'image-alt': 'Select the image, open the <strong>Settings</strong> panel (D), and fill the <strong>Alt Text</strong> field. For dynamic CMS images, set Alt on the Collection field so every item inherits it.',
                    'link-name': 'Select the link, open Settings, and edit the link text or <code>aria-label</code> as needed.',
                    'empty-heading': 'Select the heading and either type content or change its tag (H1–H6 → Paragraph) in the Settings panel.',
                    'heading-order': 'Use the Navigator panel to see the outline, then change each heading\'s tag in the Settings panel so levels read in order.',
                    'color-contrast': 'Adjust colors via the Style panel or your Style Guide variables / Variables panel.',
                    'document-title': 'Open <strong>Page Settings</strong> (gear icon on the page) and set the SEO Title Tag.'
                },
                hubspot: {
                    'image-alt': 'Edit the page, click the image module, and fill the <strong>Alt text</strong> field in the module sidebar.',
                    'link-name': 'Edit the rich-text module, select the link, and rewrite the visible link text.',
                    'document-title': 'In the page editor, open <strong>Settings → General</strong> and set the Page Title.'
                }
            };
            return (tips[platform] && tips[platform][baseId]) || '';
        },

        // Wrap a recommendation HTML string with the platform-specific tip
        // (when one exists for the rule). Used at every render site so the
        // tip surfaces in the advanced view, the walkthrough, and instance
        // navigation alike.
        decorateRecommendation: function(html, ruleId) {
            const tip = this.getPlatformTip(ruleId);
            if (!tip) return html || '';
            const label = this.getPlatformLabel();
            return (html || '') + '<div class="uw-a11y-platform-tip" data-platform="' + this.detectPlatform() + '"><strong>' + label + ' tip:</strong> ' + tip + '</div>';
        },


        // Format recommendation text with proper code escaping
        formatRecommendation: function(text) {
            // Escape HTML entities to prevent injection and structural issues
            const escapeHtml = (unsafe) => {
                return unsafe
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            };

            let escaped = escapeHtml(text);

            // Replace inline-action sentinels with real interactive buttons.
            // Sentinels are inserted by recommendation builders and survive
            // HTML escaping, so we expand them after escaping. Each entry maps
            // a sentinel to (label, icon path, onclick handler).
            const icon = (paths) => '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
            // Use data-* attributes instead of inline onclick — inline event
            // handlers are blocked by strict CSPs (script-src without
            // 'unsafe-inline'). A single delegated listener attached in
            // createPanel() reads these attributes and dispatches.
            const button = (label, iconSvg, action, arg) => {
                const attrs = ' data-uw-action="' + action + '"' + (arg ? ' data-uw-arg="' + arg + '"' : '');
                return '<button type="button" class="uw-a11y-inline-action"' + attrs + '>' + iconSvg + label + '</button>';
            };

            const ICON_SEARCH    = icon('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>');
            const ICON_HEADING   = icon('<path d="M6 4v16M18 4v16M6 12h12"/>');
            const ICON_LINK      = icon('<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07L11 5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07L13 19"/>');
            const ICON_IMAGE     = icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>');
            const ICON_EYE       = icon('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/>');
            const ICON_LAYOUT    = icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>');
            const ICON_TAB       = icon('<path d="M5 12h14M13 6l6 6-6 6"/>');
            const ICON_FOCUS     = icon('<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M3 3h3M21 3h-3M3 21h3M21 21h-3"/>');

            const replacements = [
                ['{{OPEN_CONTRAST_CHECKER}}', button('Open the built-in Contrast Checker', ICON_SEARCH, 'openContrastChecker')],
                ['{{OPEN_INSPECTOR:outline}}',  button('Open the Page Outline',      ICON_HEADING, 'openInspectorTool', 'outline')],
                ['{{OPEN_INSPECTOR:links}}',    button('Open the Links inspector',   ICON_LINK,    'openInspectorTool', 'links')],
                ['{{OPEN_INSPECTOR:alt}}',      button('Open the Alt-text inspector', ICON_IMAGE,  'openInspectorTool', 'alt')],
                ['{{OPEN_INSPECTOR:cvd}}',      button('Open Color-blindness simulation', ICON_EYE, 'openInspectorTool', 'cvd')],
                ['{{TOGGLE_LANDMARKS}}',        button('Toggle landmark overlay',    ICON_LAYOUT,  'toggleVisualization', 'landmarks')],
                ['{{TOGGLE_TAB_ORDER}}',        button('Toggle tab-order overlay',   ICON_TAB,     'toggleVisualization', 'tabOrder')],
                ['{{TOGGLE_FOCUS_INDICATORS}}', button('Toggle focus-indicator overlay', ICON_FOCUS, 'toggleVisualization', 'focusIndicators')]
            ];

            replacements.forEach(([sentinel, html]) => {
                // Escape regex metachars in sentinel for safe global replace
                const re = new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                escaped = escaped.replace(re, html);
            });

            return escaped;
        },
        
        // Escape HTML attributes (for use in HTML attributes like aria-label)
        escapeHtmlAttribute: function(unsafe) {
            if (!unsafe) return '';
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
        },
        
        // Escape HTML content (for text content in HTML elements)
        escapeHtmlContent: function(unsafe) {
            if (!unsafe) return '';
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
        },
        
        // Sanitize HTML ID values
        sanitizeHtmlId: function(id) {
            if (!id) return '';
            return id.replace(/[^a-zA-Z0-9\-_:.]/g, '-');
        },
        
        // Escape JavaScript strings (for use in onclick handlers)
        escapeJavaScript: function(unsafe) {
            if (!unsafe) return '';
            return unsafe
                .replace(/\\/g, "\\\\")
                .replace(/'/g, "\\'")
                .replace(/"/g, '\\"')
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r")
                .replace(/\t/g, "\\t");
        },
        
        // Compute a reasonably specific CSS selector for an element
        computeElementSelector: function(el) {
            try {
                if (!el || !(el instanceof Element)) return '';
                if (el.id) {
                    // Prefer ID when unique
                    const sel = `#${CSS.escape(el.id)}`;
                    if (document.querySelector(sel) === el) return sel;
                }
                const parts = [];
                let node = el;
                let depth = 0;
                while (node && node.nodeType === 1 && depth < 6 && node !== document.documentElement) {
                    const tag = node.tagName.toLowerCase();
                    let segment = tag;
                    // If reasonable class present, include one class
                    if (node.classList && node.classList.length) {
                        const cls = Array.from(node.classList).find(c => c && c.length <= 32 && !c.startsWith('uw-a11y-'));
                        if (cls) segment += `.${CSS.escape(cls)}`;
                    }
                    // nth-of-type for specificity among siblings
                    const siblings = Array.from(node.parentNode ? node.parentNode.children : []);
                    const sameTag = siblings.filter(s => s.tagName === node.tagName);
                    if (sameTag.length > 1) {
                        const index = sameTag.indexOf(node) + 1;
                        segment += `:nth-of-type(${index})`;
                    }
                    parts.unshift(segment);
                    node = node.parentElement;
                    depth++;
                }
                const sel = parts.join(' > ');
                return sel;
            } catch (_) {
                return '';
            }
        },

        // Ensure an element and its hidden ancestors are temporarily visible
        ensureElementVisible: function(el) {
            const changed = [];
            try {
                const chain = [];
                let n = el;
                while (n && n.nodeType === 1 && n !== document.body) {
                    chain.push(n);
                    n = n.parentElement;
                }

                chain.forEach(node => {
                    if (!(node instanceof Element)) return;

                    // Expand <details> blocks
                    if (node.tagName === 'DETAILS' && !node.hasAttribute('open')) {
                        node.setAttribute('open', '');
                        node.setAttribute('data-uw-a11y-details-opened', '');
                        changed.push({ node, type: 'details' });
                    }

                    const cs = getComputedStyle(node);
                    const isHiddenCss = cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0;
                    const hasHiddenAttr = node.hasAttribute('hidden');
                    const ariaHiddenTrue = node.getAttribute('aria-hidden') === 'true';

                    if (isHiddenCss) {
                        node.setAttribute('data-uw-a11y-reveal', '');
                        changed.push({ node, type: 'reveal' });
                    }
                    if (hasHiddenAttr) {
                        node.removeAttribute('hidden');
                        node.setAttribute('data-uw-a11y-removed-hidden', '');
                        changed.push({ node, type: 'hidden-attr' });
                    }
                    if (ariaHiddenTrue) {
                        node.setAttribute('aria-hidden', 'false');
                        node.setAttribute('data-uw-a11y-aria-hidden-prev', 'true');
                        changed.push({ node, type: 'aria-hidden' });
                    }
                });
            } catch (_) { /* ignore */ }

            // Return cleanup function
            return function cleanup() {
                try {
                    changed.forEach(({ node, type }) => {
                        if (!node) return;
                        if (type === 'reveal') node.removeAttribute('data-uw-a11y-reveal');
                        if (type === 'hidden-attr' && node.hasAttribute('data-uw-a11y-removed-hidden')) {
                            node.setAttribute('hidden', '');
                            node.removeAttribute('data-uw-a11y-removed-hidden');
                        }
                        if (type === 'aria-hidden' && node.getAttribute('data-uw-a11y-aria-hidden-prev') === 'true') {
                            node.setAttribute('aria-hidden', 'true');
                            node.removeAttribute('data-uw-a11y-aria-hidden-prev');
                        }
                        if (type === 'details' && node.hasAttribute('data-uw-a11y-details-opened')) {
                            node.removeAttribute('open');
                            node.removeAttribute('data-uw-a11y-details-opened');
                        }
                    });
                } catch (_) { /* ignore */ }
            };
        },
        
        // Validate and escape URLs
        escapeUrl: function(url) {
            if (!url) return '';
            try {
                // Basic URL validation
                const urlObj = new URL(url);
                // Only allow http and https protocols
                if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                    return '';
                }
                return this.escapeHtmlAttribute(url);
            } catch (e) {
                return '';
            }
        },
        
        // Extract the human-readable specifics from axe's failureSummary (e.g.
        // "Fix all of the following: aria-label attribute is not well supported
        // on a div with no valid role attribute"). Returns just the bulleted
        // reasons, with the "Fix all/any of the following:" preamble stripped.
        extractFailureSummary: function(node) {
            if (!node || !node.failureSummary) return '';
            return node.failureSummary
                .replace(/Fix any of the following:\s*/gi, '')
                .replace(/Fix all of the following:\s*/gi, '')
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
                .join(' • ');
        },

        // Manual review recommendations for verification guidance
        getManualReviewRecommendations: function() {
            return {
                // Color contrast items that need manual verification
                'color-contrast': (node, rule) => {
                    return 'Manually verify the contrast meets WCAG standards. {{OPEN_CONTRAST_CHECKER}} (foreground is prefilled from the failing element; sample the background with Pick element). For normal text, ensure at least 4.5:1 ratio; for large text (18pt+ or 14pt+ bold), ensure at least 3:1 ratio.';
                },

                'color-contrast-enhanced': (node, rule) => {
                    return 'Check if enhanced AAA contrast is needed for this content. {{OPEN_CONTRAST_CHECKER}} to measure the exact ratio — AAA requires 7:1 for normal text or 4.5:1 for large text.';
                },

                // Audio/Video content requiring manual review
                'audio-caption': (node, rule) => {
                    return 'Listen to the audio and verify: 1) Does it contain speech or important audio information? 2) Are captions or a transcript provided? 3) Are captions accurate and properly synchronized? If captions are missing, add them via <track kind="captions" src="..."> or provide a transcript adjacent to the audio.';
                },

                'video-caption': (node, rule) => {
                    return 'Watch the video and verify: 1) Does it contain speech or important audio? 2) Are captions provided for all speech and sound effects? 3) Are captions accurate and synchronized? Add captions with <track kind="captions" src="captions.vtt" srclang="en" label="English"> if missing.';
                },

                // Link purpose verification
                'link-in-text-block': (node, rule) => {
                    return 'Check that this link is distinguishable from surrounding text without relying on color alone. It needs an underline, a different font weight, or another non-color visual indicator so colorblind users can identify it. {{OPEN_INSPECTOR:cvd}} to preview the page through deuteranopia/protanopia/tritanopia filters and confirm the link still stands out.';
                },

                'identical-links-same-purpose': (node, rule) => {
                    return 'Review these links with identical text and verify they go to the same destination. If they go to different destinations, change the link text (or add aria-label) so each one is uniquely descriptive — "Learn more about pricing" vs. "Learn more about features". {{OPEN_INSPECTOR:links}} to see every link on the page and its accessible name in one list.';
                },

                // Hidden content verification
                'hidden-content': (node, rule) => {
                    return 'Verify this hidden content is appropriately hidden. If it should be available to screen readers, use display:none / visibility:hidden only when truly intended; if it should be visible to AT but not sighted users, use a visually-hidden CSS class instead of aria-hidden.';
                },

                // ARIA usage that needs manual verification
                'aria-hidden-focus': (node, rule) => {
                    return 'This element is hidden from screen readers but is still focusable, which traps keyboard users on an element they cannot perceive. Either remove aria-hidden, or remove the element from the tab order with tabindex="-1" and disable any interactive behavior.';
                },

                'aria-prohibited-attr': (node, rule) => {
                    const detail = this.extractFailureSummary(node);
                    return (detail ? detail + '. ' : '') +
                        'ARIA forbids accessible names on elements with the implicit role "generic" (plain <div>, <span>, etc.). Fix options: 1) remove the aria-label / aria-labelledby, 2) change the element to one with a real role (<nav>, <section>, <header>, <footer>, <aside>), or 3) add an explicit role like role="group" or role="region" to the existing element.';
                },

                'aria-allowed-attr': (node, rule) => {
                    const detail = this.extractFailureSummary(node);
                    return (detail ? detail + '. ' : '') +
                        'This element\'s role does not allow the ARIA attribute(s) listed above. Either remove the disallowed attribute or change the element\'s role to one that supports it. Consult https://www.w3.org/TR/wai-aria-1.2/ for the supported attributes per role.';
                },

                'aria-allowed-role': (node, rule) => {
                    const detail = this.extractFailureSummary(node);
                    return (detail ? detail + '. ' : '') +
                        'The role applied to this element is not allowed for this HTML tag (for example, role="button" on an <a> with an href, or role="heading" on an <h2>). Prefer the native semantic element, or remove the role.';
                },

                'aria-roledescription': (node, rule) => {
                    return 'aria-roledescription replaces the role announced to screen readers. Verify the custom description is meaningful, localized, and only applied to elements with a non-abstract role. Test with NVDA, JAWS, or VoiceOver to confirm announcements are clear.';
                },

                'aria-text': (node, rule) => {
                    return 'role="text" tells screen readers to announce this element\'s content as a single text run, ignoring inner elements. Verify all important interactive descendants are still keyboard reachable and that the flattened announcement still conveys the meaning.';
                },

                'empty-table-header': (node, rule) => {
                    return 'This table header (<th>) appears empty. Verify whether it is intentionally blank (e.g. a corner cell) — if so, leave it; otherwise add header text describing the column or row.';
                },

                'frame-tested': (node, rule) => {
                    return 'axe could not run inside this iframe (cross-origin or sandboxed). Manually load the framed content and run an accessibility scan against it directly, or coordinate with the iframe\'s owner to ensure it is tested.';
                },

                'frame-title-unique': (node, rule) => {
                    return 'Two or more iframes share the same title. If they show different content, give each a unique, descriptive title attribute so screen-reader users can distinguish them.';
                },

                'scrollable-region-focusable': (node, rule) => {
                    return 'A scrollable region must be reachable by keyboard. Add tabindex="0" to the scrolling element and a meaningful accessible name (aria-label or aria-labelledby) so keyboard users can scroll it without a mouse.';
                },

                'focus-order-semantics': (node, rule) => {
                    return 'A non-semantic element (div/span) is in the tab order. Replace it with a semantic <button>, <a>, or <input>, OR add an appropriate role (role="button", role="link") and ensure keyboard handlers (Enter/Space) are wired up. {{TOGGLE_TAB_ORDER}} to see where this element falls in the focus sequence.';
                },

                'presentation-role-conflict': (node, rule) => {
                    return 'role="presentation" / role="none" was applied to an element that has interactive children, an accessible name, or focusable descendants — the role is being ignored. Either remove the role, or remove the interactive/focusable content from the element.';
                },

                'tabindex': (node, rule) => {
                    return 'Verify this positive tabindex value is necessary. Positive tabindex (1, 2, 3...) overrides natural DOM order and almost always creates a confusing focus order. Prefer tabindex="0" and let the DOM order determine focus. {{TOGGLE_TAB_ORDER}} to see the actual focus order on the page.';
                },

                // Complex widgets requiring manual testing
                'nested-interactive': (node, rule) => {
                    return 'This interactive element contains another interactive descendant (e.g. a button inside a link). Screen readers cannot expose nested interactives reliably. Restructure so each interactive control is a sibling, not a descendant.';
                },

                // Landmarks
                'landmark-unique': (node, rule) => {
                    return 'Multiple landmarks of the same type exist on the page (e.g. two <nav>s). Add a distinguishing aria-label or aria-labelledby to each one — for example aria-label="Primary" and aria-label="Footer" on two <nav> elements. {{TOGGLE_LANDMARKS}} to see every landmark on the page and which ones share names.';
                },

                'landmark-no-duplicate-banner': (node, rule) => {
                    return 'A <header> at the top level of the page (or role="banner") may only appear once. If you have multiple banners, demote the extras into a <section> with a heading, or scope them inside an <article> / <main>.';
                },

                'landmark-no-duplicate-contentinfo': (node, rule) => {
                    return 'A page-level <footer> (or role="contentinfo") may only appear once. Move duplicate footers into <article> or <section>, or remove the duplicate role.';
                },

                'landmark-banner-is-top-level': (node, rule) => {
                    return 'The <header>/banner landmark is nested inside another landmark (likely <main> or <article>). Move it out so it is a top-level child of <body>.';
                },

                'landmark-complementary-is-top-level': (node, rule) => {
                    return 'The <aside>/complementary landmark is nested inside another landmark. Move it so it is a direct child of <body>, or remove the role if the content is not actually complementary to the page.';
                },

                'landmark-contentinfo-is-top-level': (node, rule) => {
                    return 'The <footer>/contentinfo landmark is nested inside another landmark. Move it to be a top-level child of <body>.';
                },

                'landmark-main-is-top-level': (node, rule) => {
                    return 'The <main> landmark is nested inside another landmark. Move it to be a direct child of <body> — there should be exactly one top-level <main>.';
                },

                'region': (node, rule) => {
                    return 'Some content sits outside any landmark, so screen-reader users cannot jump to it via the landmarks rotor. Wrap it in a <main>, <nav>, <aside>, <section aria-labelledby="...">, <header>, or <footer> as appropriate. {{TOGGLE_LANDMARKS}} to see what is currently inside vs. outside a landmark.';
                },

                'bypass': (node, rule) => {
                    return 'The page lacks a skip link or keyboard bypass. Add a skip link as the first focusable element: <a href="#main" class="skip-link">Skip to main content</a>, and ensure your <main> element has id="main". {{TOGGLE_TAB_ORDER}} to verify a skip link is the first focusable element after activating it.';
                },

                // Headings
                'heading-structure': (node, rule) => {
                    return 'Review the heading structure for logical flow. Headings should describe content hierarchy: H1 for page title, H2 for major sections, H3 nested under H2, etc. Don\'t skip levels or use heading tags purely for visual styling. {{OPEN_INSPECTOR:outline}} to see the full heading and landmark outline.';
                },

                'empty-heading': (node, rule) => {
                    return 'This heading appears empty. If it is decorative or holds an icon, remove the heading element. If it should be a heading, add visible text content. {{OPEN_INSPECTOR:outline}} to see how this heading appears in the page outline.';
                },

                // Forms
                'autocomplete-valid': (node, rule) => {
                    return 'The autocomplete attribute value is not in the WHATWG autofill spec. Use values like "name", "email", "tel", "street-address", "postal-code", "cc-number". See https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill for the full list.';
                },

                'autocomplete-appropriate': (node, rule) => {
                    return 'Verify the autocomplete value matches the field\'s purpose. autocomplete="name" should only be on a name field; autocomplete="email" only on an email field. Mismatches confuse password managers and assistive technology.';
                },

                // Meta
                'meta-refresh': (node, rule) => {
                    return 'A meta refresh redirects automatically, which can disorient users with cognitive disabilities and screen-reader users. Either remove the redirect or replace it with a user-controlled action ("Continue" button) and ensure the delay is at least 20× longer than needed, or removable.';
                },

                // Default for other manual review items — surface axe's own
                // specifics so users see something actionable.
                'default': (node, rule) => {
                    const detail = this.extractFailureSummary(node);
                    const help = rule && rule.help ? rule.help : '';
                    if (detail) {
                        return `${detail}. ` + (help ? `(${help}.) ` : '') +
                            'Manually verify this element meets the rule above and test with assistive technologies if possible.';
                    }
                    return (help ? `${help}. ` : '') +
                        'Manually verify this element meets accessibility requirements — review the content, test with assistive technologies, and ensure it provides equivalent access for all users.';
                }
            };
        },
        
        // Comprehensive mapping of actionable recommendations
        getActionableRecommendations: function() {
            return {
                // Images and Media
                'image-alt': (node, rule) => {
                    const element = this.getElementFromNode(node);
                    if (element && element.tagName === 'IMG') {
                        if (element.src && element.src.includes('decorative') || element.getAttribute('role') === 'presentation') {
                            return 'Add alt="" for decorative images, or add role="presentation" if the image is purely decorative. {{OPEN_INSPECTOR:alt}} to review every image\'s alt text in one list.';
                        }
                        return 'Add descriptive alt text: <img src="..." alt="Brief description...">. Describe the content and function, not just "image of..." {{OPEN_INSPECTOR:alt}} to review every image\'s alt text in one list.';
                    }
                    return 'Add appropriate alt text describing the image content and purpose. {{OPEN_INSPECTOR:alt}} to review every image\'s alt text in one list.';
                },

                'image-redundant-alt': 'Remove redundant words like "image of", "picture of", "graphic of" from alt text. Just describe what the image shows: alt="Red sports car" instead of alt="Image of a red sports car". {{OPEN_INSPECTOR:alt}} to scan every image\'s alt text at once.',
                
                // Forms
                'label': (node, rule) => {
                    const element = this.getElementFromNode(node);
                    if (element) {
                        const id = element.id || 'unique-id';
                        const type = element.type || 'text';
                        return `Add a label: <label for="${id}">Field Name</label><input type="${type}" id="${id}"> OR use aria-label: <input type="${type}" aria-label="Field Name">`;
                    }
                    return 'Associate each form control with a descriptive label using <label> or aria-label.';
                },
                
                'button-name': (node, rule) => {
                    const element = this.getElementFromNode(node);
                    if (element) {
                        if (element.innerHTML.trim() === '') {
                            return 'Add text content inside the button: <button>Submit Form</button> OR add aria-label: <button aria-label="Submit form">👍</button>';
                        }
                        return 'Ensure button has accessible text via text content, aria-label, or aria-labelledby.';
                    }
                    return 'Buttons need accessible names - add text content or aria-label.';
                },
                
                'duplicate-id': 'Make each ID unique. Find duplicate IDs in your HTML and rename them. Each ID must be used only once per page.',
                
                // Color and Contrast
                'color-contrast': (node, rule) => {
                    const colorInfo = this.extractColorContrastInfo(node);
                    if (colorInfo) {
                        return `Current contrast is ${colorInfo.contrast} or may be difficult to determine due to the use of a gradient or image background. WCAG AA requires 4.5:1 for normal text, 3:1 for large text (18pt+ or 14pt+ bold). {{OPEN_CONTRAST_CHECKER}} to test alternate color combinations.`;
                    }
                    return 'Improve text contrast ratio. Use darker text on light backgrounds or lighter text on dark backgrounds. {{OPEN_CONTRAST_CHECKER}} to test combinations.';
                },
                
                // Links
                'link-name': 'Make link text descriptive. Instead of "click here" or "read more", use "Download annual report" or "Read more about accessibility testing". The link text should make sense out of context. {{OPEN_INSPECTOR:links}} to audit every link on the page.',

                'link-in-text-block': 'Links in text need visual distinction beyond color alone. Add underlines, bold text, or other visual indicators that work for colorblind users. {{OPEN_INSPECTOR:cvd}} to preview the page with colorblindness filters applied.',

                // Headings
                'heading-order': (node, rule) => {
                    const element = this.getElementFromNode(node);
                    if (element) {
                        const level = parseInt(element.tagName.charAt(1));
                        return `Fix heading sequence - don't skip levels. After H${level-2}, use H${level-1}, not H${level}. Structure should be H1→H2→H3, not H1→H3. {{OPEN_INSPECTOR:outline}} to see the full heading outline.`;
                    }
                    return 'Use headings in sequential order (H1, H2, H3...) without skipping levels. Think of headings as a document outline. {{OPEN_INSPECTOR:outline}} to see the full heading outline.';
                },

                'empty-heading': 'Add meaningful text inside headings. Remove empty headings or add descriptive content: <h2>Our Services</h2>. {{OPEN_INSPECTOR:outline}} to see how this affects the heading outline.',
                
                // ARIA
                'aria-allowed-attr': 'Remove unsupported ARIA attributes from this element type. Check the ARIA specification for which attributes are valid for each element.',
                
                'aria-required-attr': 'Add required ARIA attributes. For example, role="button" needs aria-label or text content. Check ARIA patterns for required attributes.',
                
                'aria-valid-attr-value': 'Fix ARIA attribute values. Use valid values like aria-expanded="true" or "false", not "yes" or other invalid values.',
                
                'button-name': 'Add accessible name to button using text content, aria-label, or aria-labelledby.',
                
                // Tables
                'table-fake-caption': 'Use proper <caption> element instead of fake caption. Move the caption text inside: <table><caption>Sales Data 2024</caption><tr>...</table>',
                
                'td-headers-attr': 'Add headers attribute to complex table cells: <td headers="row1 col2">Data</td> where "row1 col2" are IDs of header cells.',
                
                'th-has-data-cells': 'Ensure table headers (th) actually relate to data cells. Remove empty or irrelevant header cells.',
                
                // Structure
                'region': 'Add landmark regions using HTML5 elements: <main>, <nav>, <aside>, <header>, <footer>. OR use ARIA: <div role="main">, <div role="navigation">. {{TOGGLE_LANDMARKS}} to see what is currently inside vs. outside a landmark.',

                'page-has-heading-one': 'Add exactly one H1 heading per page. The H1 should describe the main content: <h1>Page Title</h1>. {{OPEN_INSPECTOR:outline}} to see the full heading outline.',

                'landmark-one-main': 'Add one <main> element per page: <main><!-- main content here --></main> OR <div role="main">. {{TOGGLE_LANDMARKS}} to see all landmarks on the page.',
                
                // Lists
                'list': 'Use proper list markup. Wrap list items in <ul> or <ol>: <ul><li>Item 1</li><li>Item 2</li></ul>',
                
                'definition-list': 'Use proper definition list structure: <dl><dt>Term</dt><dd>Definition</dd></dl>',
                
                // Focus and Keyboard
                'focus-order-semantics': 'Use semantic HTML elements (button, a, input) instead of div/span with click handlers. This ensures proper keyboard focus order.',
                
                'tabindex': 'Remove positive tabindex values (tabindex="1", "2", etc). Use tabindex="0" to make elements focusable or tabindex="-1" to remove from tab order. {{TOGGLE_TAB_ORDER}} to see the actual focus order on the page.',
                
                // Language
                'html-has-lang': 'Add language attribute to html element: <html lang="en"> or <html lang="es"> for Spanish, etc.',
                
                'html-lang-valid': 'Use valid language code. Examples: "en" for English, "es" for Spanish, "fr" for French. Use format like "en-US" for regional variants.',
                
                // Audio/Video
                'audio-caption': 'Add captions to audio content using <track> element with captions file, or provide transcript nearby.',
                
                'video-caption': 'Add captions: <video><track kind="captions" src="captions.vtt" srclang="en" label="English"></video>',
                
                // Meta
                'meta-refresh': 'Remove auto-refresh meta tags. Use JavaScript with user control: <button onclick="refresh()">Refresh Page</button>',
                
                'meta-viewport': 'Add viewport meta tag: <meta name="viewport" content="width=device-width, initial-scale=1.0">',
                
                // Misc
                'duplicate-id-active': 'Remove duplicate IDs from interactive elements. Each ID must be unique across the entire page.',
                
                'duplicate-id-aria': 'Fix duplicate IDs used in ARIA relationships (aria-labelledby, aria-describedby). Each referenced ID must be unique.',
                
                'frame-title': 'Add descriptive title to iframe: <iframe title="Customer feedback form" src="..."></iframe>',
                
                'object-alt': 'Add alternative text to <object> elements via inner content: <object data="chart.svg" type="image/svg+xml">Sales chart showing 20% increase</object>. {{OPEN_INSPECTOR:alt}} to review every visual element\'s alt text.',
                
                'scope-attr-valid': 'Use valid scope attribute values on table headers: scope="col" for column headers, scope="row" for row headers.',
                
                'skip-link': 'Add skip navigation link at page start: <a href="#main" class="skip-link">Skip to main content</a>',
                
                'css-orientation-lock': 'Don\'t lock orientation in CSS. Remove or modify CSS that prevents rotation: transform: rotate() or orientation locks.'
            };
        },
        
        // Get DOM element from axe node data
        getElementFromNode: function(node) {
            if (node.target && node.target.length > 0) {
                try {
                    // Use axe's selector to find the element
                    return document.querySelector(node.target[0]);
                } catch (e) {
                    // Fallback: try to find by other means
                    return null;
                }
            }
            return null;
        },

        // Check if a node belongs to our accessibility checker UI
        isOwnUIElement: function(node) {
            // Check the CSS selector for our UI elements
            if (node.target && node.target[0]) {
                const selector = node.target[0];
                
                // Check if it's our container, panel, or any child element
                if (selector.includes('#uw-a11y-container') || 
                    selector.includes('#uw-a11y-panel') || 
                    selector.includes('uw-a11y-')) {
                    return true;
                }
            }
            
            // Check the HTML content for our UI elements
            if (node.html) {
                if (node.html.includes('uw-a11y-') || 
                    node.html.includes('id="uw-a11y-') ||
                    node.html.includes('class="uw-a11y-') ||
                    node.html.includes('Loading axe-core') ||
                    node.html.includes('Pinpoint Accessibility Checker')) {
                    return true;
                }
            }
            
            // Check the actual DOM element if available
            const element = this.getElementFromNode(node);
            if (element) {
                // Check if element is inside our container or panel
                const container = document.getElementById('uw-a11y-container');
                const panel = document.getElementById('uw-a11y-panel');
                
                if (container && (element === container || container.contains(element))) {
                    return true;
                }
                
                if (panel && (element === panel || panel.contains(element))) {
                    return true;
                }
                
                // Check if element has our CSS classes
                if (element.className && typeof element.className === 'string') {
                    if (element.className.includes('uw-a11y-')) {
                        return true;
                    }
                }
                
                // Check if element has our ID pattern
                if (element.id && element.id.includes('uw-a11y-')) {
                    return true;
                }
                
                // Check if element is within shadow DOM
                if (element.getRootNode && element.getRootNode() !== document) {
                    const shadowRoot = element.getRootNode();
                    if (shadowRoot.host && shadowRoot.host.id === 'uw-a11y-container') {
                        return true;
                    }
                }
            }
            
            return false;
        },
        
        // Build detailed technical information about the issue
        buildDetailedInfo: function(rule, node) {
            const details = [];
            
            // Add HTML source context with line number estimation
            if (node.html) {
                details.push({
                    type: 'html',
                    label: 'HTML Source',
                    value: node.html
                });
                
                // Try to estimate line number
                const lineNumber = this.estimateLineNumber(node.html);
                if (lineNumber > 0) {
                    details.push({
                        type: 'line',
                        label: 'Approximate Line',
                        value: lineNumber
                    });
                }
            }
            
            // Add CSS selector
            if (node.target && node.target[0]) {
                details.push({
                    type: 'selector',
                    label: 'CSS Selector',
                    value: node.target[0]
                });
            }
            
            // Add specific rule-based details
            if (rule.id === 'color-contrast') {
                const colorInfo = this.extractColorContrastInfo(node);
                if (colorInfo) {
                    details.push({
                        type: 'colors',
                        label: 'Color Information',
                        value: colorInfo
                    });
                }
            }
            
            if (rule.id.includes('landmark') || rule.id.includes('region')) {
                details.push({
                    type: 'landmarks',
                    label: 'Landmark Context',
                    value: this.analyzeLandmarkContext(node)
                });
            }
            
            if (rule.id.includes('heading')) {
                details.push({
                    type: 'headings',
                    label: 'Heading Structure',
                    value: this.analyzeHeadingStructure(node)
                });
            }
            
            // Add failure summary details
            if (node.failureSummary) {
                details.push({
                    type: 'failure',
                    label: 'Technical Details',
                    value: node.failureSummary
                });
            }
            
            // Add any additional data from axe
            if (node.any && node.any.length > 0) {
                const anyDetails = node.any.map(item => item.message || item.id).filter(Boolean);
                if (anyDetails.length > 0) {
                    details.push({
                        type: 'checks',
                        label: 'Failed Checks',
                        value: anyDetails.join(', ')
                    });
                }
            }
            
            return details;
        },
        
        // Estimate line number by counting newlines in document
        estimateLineNumber: function(htmlSnippet) {
            try {
                const documentHTML = document.documentElement.outerHTML;
                const index = documentHTML.indexOf(htmlSnippet.substring(0, 50));
                if (index > -1) {
                    const beforeSnippet = documentHTML.substring(0, index);
                    return beforeSnippet.split('\n').length;
                }
            } catch (e) {
                // Fallback: return 0 if estimation fails
            }
            return 0;
        },
        
        // Recognize CSS background-images that are decorative thin lines
        // (fake underlines/borders done via `background-size: ... 2px`) rather
        // than a real background behind the text. These shouldn't be measured
        // as the element's background — the contrast walk should keep going.
        // Currently catches explicit pixel heights ≤ 4px; percentage/keyword
        // heights pass through (handled by the more-robust path if we add it).
        isDecorativeThinBackground: function(computedStyles) {
            const bgSize = computedStyles && computedStyles.backgroundSize;
            if (!bgSize) return false;
            // Only consider the first layer if multiple backgrounds are stacked.
            const firstLayer = bgSize.split(',')[0].trim();
            const parts = firstLayer.split(/\s+/);
            const heightStr = parts[1] || parts[0];
            const pxMatch = heightStr && heightStr.match(/^([\d.]+)px$/);
            return !!(pxMatch && parseFloat(pxMatch[1]) <= 4);
        },

        // Extract color contrast information with enhanced pixel-based analysis
        extractColorContrastInfo: function(node) {
            try {
                const element = this.getElementFromNode(node);
                if (!element) return null;
                
                const styles = window.getComputedStyle(element);
                let fgColor = styles.color;
                let bgColor = styles.backgroundColor;
                let analysisMethod = 'computed-style';

                // ── Gradient backgrounds ───────────────────────────────────────
                // CSS gradients live in backgroundImage, not backgroundColor, so
                // bgColor is always transparent for gradient elements. We handle
                // this BEFORE the transparency walk-up to avoid landing on the
                // wrong ancestor color. We sample all gradient stops + midpoints
                // and return the worst-case (lowest) contrast position.
                const checkGradient = (el) => {
                    const cs = window.getComputedStyle(el);
                    const bgImg = cs.backgroundImage;
                    if (!bgImg || bgImg === 'none' || !bgImg.includes('gradient')) return null;
                    if (this.isDecorativeThinBackground(cs)) return null;
                    return bgImg;
                };

                // Check element itself first, then up to 3 ancestor levels.
                // Also track WHICH element owns the gradient for positional sampling.
                let gradientSource = checkGradient(element);
                let gradientEl = gradientSource ? element : null;
                if (!gradientSource) {
                    let anc = element.parentElement;
                    for (let d = 0; d < 3 && anc; d++, anc = anc.parentElement) {
                        const g = checkGradient(anc);
                        if (g) { gradientSource = g; gradientEl = anc; break; }
                    }
                }

                if (gradientSource) {
                    const gradResult = this.analyzeGradientBackground(gradientSource, fgColor, element, gradientEl);
                    if (gradResult) {
                        return {
                            foreground:    gradResult.foreground,
                            background:    `${gradResult.background} (worst of ${gradResult.sampleCount} gradient samples)`,
                            contrast:      gradResult.contrastRatio.toFixed(2) + ':1',
                            required:      'WCAG AA requires 4.5:1 for normal text, 3:1 for large text',
                            analysisMethod: 'gradient-analysis'
                        };
                    }
                }

                // ── Image overlap detection ────────────────────────────────────
                // When text is CSS-positioned over an <img> element the effective
                // background is the image's pixels, not any ancestor CSS color.
                // Canvas pixel-sampling works for data: URIs and same-origin images
                // without CORS restrictions; it gracefully fails for cross-origin src.
                const isTransparentBg = !bgColor || bgColor === 'transparent'
                    || bgColor === 'rgba(0, 0, 0, 0)' || bgColor.includes('rgba(0, 0, 0, 0)');
                let overlapsUnsampledImage = false;

                // Try same-origin <img> pixel sampling first (works for data: URIs etc.)
                if (isTransparentBg) {
                    const overlappingImgs = this.findOverlappingImages(element);
                    for (const img of overlappingImgs) {
                        const sampled = this.sampleImagePixelsAtElement(img, element);
                        if (sampled) {
                            bgColor = sampled;
                            analysisMethod = 'image-pixel-sampling';
                            break;
                        } else {
                            // Image found but pixel sampling failed (e.g. cross-origin CORS block).
                            overlapsUnsampledImage = true;
                        }
                    }
                }

                // Use elementsFromPoint to scan the full rendering stack at the element's
                // center — this catches CSS background-image on ancestors AND on z-index
                // siblings (e.g. a hero div that is adjacent in the DOM but visually behind
                // the text via position:absolute).  Ancestor walks miss the sibling case.
                if (!overlapsUnsampledImage) {
                    try {
                        const rect = element.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            const cx = rect.left + rect.width / 2;
                            const cy = rect.top  + rect.height / 2;
                            const stackedEls = document.elementsFromPoint(cx, cy) || [];
                            for (const el of stackedEls) {
                                if (el === element) continue;
                                // Skip the checker's own UI
                                if (el.closest && el.closest('#uw-a11y-container')) continue;
                                const elS = window.getComputedStyle(el);
                                const elBi = elS.backgroundImage;
                                // Found a real background image somewhere in the stack
                                if (elBi && elBi !== 'none' && elBi.includes('url(')) {
                                    overlapsUnsampledImage = true;
                                    break;
                                }
                                // Stop scanning deeper once we hit a fully opaque solid-color
                                // element — it reliably covers everything behind it.
                                const elBg = elS.backgroundColor;
                                const isOpaqueSolid = elBg
                                    && elBg !== 'transparent'
                                    && elBg !== 'rgba(0, 0, 0, 0)'
                                    && !elBg.includes('rgba(0, 0, 0, 0)')
                                    && (!elBi || elBi === 'none')
                                    && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0*(?:\.\d+)?\s*\)/.test(elBg);
                                if (isOpaqueSolid) break;
                            }
                        }
                    } catch (e) { /* elementsFromPoint not available, skip */ }
                }

                // Handle transparent or rgba(0,0,0,0) backgrounds by finding the effective background
                if (!bgColor || bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)' || bgColor.includes('rgba(0, 0, 0, 0)')) {
                    // Walk up the DOM tree to find the first non-transparent background
                    let parent = element.parentElement;
                    while (parent && parent !== document.body) {
                        const parentStyles = window.getComputedStyle(parent);
                        const parentBg = parentStyles.backgroundColor;
                        if (parentBg && parentBg !== 'transparent' && parentBg !== 'rgba(0, 0, 0, 0)' && !parentBg.includes('rgba(0, 0, 0, 0)')) {
                            bgColor = parentBg;
                            break;
                        }
                        parent = parent.parentElement;
                    }
                    
                    // If still no background found, assume white (common default)
                    if (!bgColor || bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)' || bgColor.includes('rgba(0, 0, 0, 0)')) {
                        bgColor = '#ffffff';
                    }
                }

                // Composite partial-alpha RGBA backgrounds against the nearest solid ancestor.
                // axe-core can't do this, so it flags them as needing manual review even
                // when the actual rendered contrast clearly passes.
                if (bgColor && /^rgba\(/i.test(bgColor)) {
                    const alphaMatch = bgColor.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/i);
                    if (alphaMatch) {
                        const alpha = parseFloat(alphaMatch[4]);
                        if (alpha > 0 && alpha < 1) {
                            // Walk up to find the nearest solid (non-transparent) ancestor background
                            let solidAncestor = 'rgb(255, 255, 255)'; // safe fallback
                            let anc = element.parentElement;
                            while (anc && anc !== document.documentElement) {
                                const ancBg = window.getComputedStyle(anc).backgroundColor;
                                if (ancBg && ancBg !== 'transparent' && ancBg !== 'rgba(0, 0, 0, 0)'
                                        && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/i.test(ancBg)) {
                                    const ancAlphaM = ancBg.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i);
                                    // Only treat as solid if opaque (or rgb())
                                    if (!ancAlphaM || parseFloat(ancAlphaM[1]) >= 1) {
                                        solidAncestor = ancBg;
                                        break;
                                    }
                                }
                                anc = anc.parentElement;
                            }

                            const ancMatch = solidAncestor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
                            if (ancMatch) {
                                // Porter-Duff over: out = alpha * src + (1-alpha) * dst
                                const cr = Math.round(parseInt(alphaMatch[1]) * alpha + parseInt(ancMatch[1]) * (1 - alpha));
                                const cg = Math.round(parseInt(alphaMatch[2]) * alpha + parseInt(ancMatch[2]) * (1 - alpha));
                                const cb = Math.round(parseInt(alphaMatch[3]) * alpha + parseInt(ancMatch[3]) * (1 - alpha));
                                bgColor = `rgb(${cr}, ${cg}, ${cb})`;
                                analysisMethod = 'dom-compositing';
                            }
                        }
                    }
                }

                // Enhanced pixel-based analysis for complex cases (gradients, images, etc.)
                const pixelAnalysis = this.analyzeElementPixels(element);
                if (pixelAnalysis && pixelAnalysis.isMoreAccurate) {
                    fgColor = pixelAnalysis.foreground;
                    bgColor = pixelAnalysis.background;
                    analysisMethod = 'pixel-analysis';
                }
                
                // Calculate contrast ratio if possible
                const contrast = this.calculateContrastRatio(fgColor, bgColor);
                
                return {
                    foreground: fgColor,
                    background: bgColor,
                    contrast: contrast ? contrast.toFixed(2) + ':1' : 'Unable to calculate',
                    required: 'WCAG AA requires 4.5:1 for normal text, 3:1 for large text',
                    analysisMethod: analysisMethod,
                    overlapsUnsampledImage: overlapsUnsampledImage
                };
            } catch (e) {
                console.warn('Error extracting color contrast info:', e);
                return null;
            }
        },
        
        // WCAG compliant contrast ratio calculation
        calculateContrastRatio: function(fg, bg) {
            try {
                const fgLuminance = this.getLuminance(fg);
                const bgLuminance = this.getLuminance(bg);
                
                // Return null if we can't calculate luminance for either color
                if (fgLuminance === null || bgLuminance === null) {
                    console.warn('Could not calculate luminance for colors:', fg, bg);
                    return null;
                }
                
                // WCAG contrast ratio formula: (L1 + 0.05) / (L2 + 0.05)
                // where L1 is the lighter color and L2 is the darker color
                const lighter = Math.max(fgLuminance, bgLuminance);
                const darker = Math.min(fgLuminance, bgLuminance);
                
                const contrast = (lighter + 0.05) / (darker + 0.05);
                
                // Ensure we return a reasonable value
                if (isNaN(contrast) || !isFinite(contrast)) {
                    console.warn('Invalid contrast ratio calculated for colors:', fg, bg);
                    return null;
                }
                
                return contrast;
            } catch (e) {
                console.warn('Error calculating contrast ratio:', e);
                return null;
            }
        },
        
        // Get relative luminance (WCAG compliant)
        getLuminance: function(color) {
            try {
                let r, g, b;
                
                // Handle different color formats
                if (color.startsWith('#')) {
                    // Hex color
                    const hex = color.slice(1);
                    if (hex.length === 3) {
                        // Short hex (#rgb)
                        r = parseInt(hex[0] + hex[0], 16);
                        g = parseInt(hex[1] + hex[1], 16);
                        b = parseInt(hex[2] + hex[2], 16);
                    } else if (hex.length === 6) {
                        // Long hex (#rrggbb)
                        r = parseInt(hex.slice(0, 2), 16);
                        g = parseInt(hex.slice(2, 4), 16);
                        b = parseInt(hex.slice(4, 6), 16);
                    } else {
                        return null;
                    }
                } else if (color.startsWith('rgb')) {
                    // RGB/RGBA color
                    const values = color.match(/\d+/g);
                    if (values && values.length >= 3) {
                        r = parseInt(values[0]);
                        g = parseInt(values[1]);
                        b = parseInt(values[2]);
                    } else {
                        return null;
                    }
                } else {
                    // Named colors - basic support for common ones
                    const namedColors = {
                        'white': [255, 255, 255],
                        'black': [0, 0, 0],
                        'red': [255, 0, 0],
                        'green': [0, 128, 0],
                        'blue': [0, 0, 255],
                        'yellow': [255, 255, 0],
                        'cyan': [0, 255, 255],
                        'magenta': [255, 0, 255],
                        'silver': [192, 192, 192],
                        'gray': [128, 128, 128],
                        'grey': [128, 128, 128]
                    };
                    
                    const colorName = color.toLowerCase().trim();
                    if (namedColors[colorName]) {
                        [r, g, b] = namedColors[colorName];
                    } else {
                        return null;
                    }
                }
                
                // Apply gamma correction (sRGB to linear RGB)
                const gammaCorrect = (c) => {
                    c = c / 255;
                    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
                };
                
                const rLinear = gammaCorrect(r);
                const gLinear = gammaCorrect(g);
                const bLinear = gammaCorrect(b);
                
                // Calculate relative luminance using WCAG formula
                return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
                
            } catch (e) {
                console.warn('Error calculating luminance for color:', color, e);
                return null;
            }
        },

        // Analyze element pixels for more accurate color detection
        analyzeElementPixels: function(element) {
            try {
                // Skip pixel analysis for elements that are likely to work fine with computed styles
                const computedStyles = window.getComputedStyle(element);
                const hasComplexBackground = this.hasComplexBackground(element, computedStyles);
                const hasTransparency = this.hasTransparentColors(computedStyles);
                
                if (!hasComplexBackground && !hasTransparency) {
                    return null; // Use computed styles
                }

                const rect = element.getBoundingClientRect();
                if (rect.width < 4 || rect.height < 4) {
                    return null; // Element too small for reliable sampling
                }

                // Use a simpler approach: sample the rendered element directly
                const colorSamples = this.sampleElementColors(element, rect);
                
                if (colorSamples && this.isPixelAnalysisMoreReliable(colorSamples, computedStyles)) {
                    return {
                        foreground: colorSamples.foreground,
                        background: colorSamples.background,
                        isMoreAccurate: true,
                        samplingMethod: colorSamples.method
                    };
                }

                return null;
            } catch (e) {
                console.warn('Error in pixel analysis:', e);
                return null;
            }
        },

        // Check if element has complex background that might need pixel analysis
        hasComplexBackground: function(element, styles) {
            // A thin decorative background (fake underline) isn't really a
            // background behind the text — don't pull in pixel analysis for it.
            const hasOwnBg = (styles.backgroundImage !== 'none' || styles.background.includes('gradient'))
                && !this.isDecorativeThinBackground(styles);
            return hasOwnBg || this.hasComplexAncestorBackground(element);
        },

        // Check if colors contain transparency
        hasTransparentColors: function(styles) {
            const fgColor = styles.color;
            const bgColor = styles.backgroundColor;
            
            return (
                fgColor.includes('rgba') && this.getAlphaFromRgba(fgColor) < 1 ||
                bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent'
            );
        },

        // Check ancestor elements for complex backgrounds
        hasComplexAncestorBackground: function(element) {
            let parent = element.parentElement;
            let depth = 0;
            
            while (parent && depth < 5) { // Check up to 5 levels up
                const parentStyles = window.getComputedStyle(parent);
                if ((parentStyles.backgroundImage !== 'none' ||
                    parentStyles.background.includes('gradient'))
                    && !this.isDecorativeThinBackground(parentStyles)) {
                    return true;
                }
                parent = parent.parentElement;
                depth++;
            }
            return false;
        },

        // Extract alpha value from rgba string
        getAlphaFromRgba: function(rgbaString) {
            const match = rgbaString.match(/rgba?\([^)]+\)/);
            if (match) {
                const values = match[0].match(/[\d.]+/g);
                return values && values.length >= 4 ? parseFloat(values[3]) : 1;
            }
            return 1;
        },

        // Sample colors from element using appropriate method based on complexity
        sampleElementColors: function(element, rect) {
            try {
                // Check if element has background image - use canvas sampling
                const styles = window.getComputedStyle(element);
                const hasBackgroundImage = this.hasBackgroundImage(element);
                
                if (hasBackgroundImage) {
                    return this.canvasBasedColorSampling(element, rect);
                }
                
                // For non-image backgrounds, use lightweight DOM sampling
                return this.domBasedColorSampling(element);
            } catch (e) {
                console.warn('Error sampling element colors:', e);
                return null;
            }
        },

        // Check if element or ancestors have background images
        hasBackgroundImage: function(element) {
            let current = element;
            let depth = 0;
            
            while (current && depth < 3) { // Check element and 2 levels up
                const styles = window.getComputedStyle(current);
                const bgImage = styles.backgroundImage;
                
                if (bgImage && bgImage !== 'none' && !bgImage.includes('gradient')) {
                    return true;
                }
                
                current = current.parentElement;
                depth++;
            }
            return false;
        },

        // Canvas-based color sampling for complex backgrounds like images
        canvasBasedColorSampling: function(element, rect) {
            try {
                // Create canvas for rendering
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Set reasonable canvas size (limit for performance)
                const maxDimension = 100;
                const scale = Math.min(maxDimension / rect.width, maxDimension / rect.height, 1);
                canvas.width = Math.max(Math.ceil(rect.width * scale), 20);
                canvas.height = Math.max(Math.ceil(rect.height * scale), 20);
                
                // Try to render element area using html2canvas-like approach
                const elementColors = this.renderElementToCanvas(ctx, element, rect, scale);
                
                if (elementColors) {
                    return {
                        foreground: elementColors.foreground,
                        background: elementColors.background,
                        method: 'canvas-pixel-sampling'
                    };
                }
                
                // Fallback to DOM sampling if canvas fails
                return this.domBasedColorSampling(element);
                
            } catch (e) {
                console.warn('Canvas sampling failed, falling back to DOM sampling:', e);
                return this.domBasedColorSampling(element);
            }
        },

        // Render element to canvas and sample colors
        renderElementToCanvas: function(ctx, element, rect, scale) {
            try {
                const canvas = ctx.canvas;
                
                // Fill with background
                this.renderBackground(ctx, element, canvas.width, canvas.height);
                
                // Sample background pixels (before text)
                const bgSamples = this.sampleCanvasPixels(ctx, canvas.width, canvas.height, 'background');
                
                // Render text content
                this.renderTextContent(ctx, element, scale);
                
                // Sample foreground pixels (text areas)
                const fgSamples = this.sampleCanvasPixels(ctx, canvas.width, canvas.height, 'foreground');
                
                if (bgSamples && fgSamples) {
                    return {
                        background: bgSamples,
                        foreground: fgSamples
                    };
                }
                
                return null;
            } catch (e) {
                console.warn('Error rendering element to canvas:', e);
                return null;
            }
        },

        // Render background (including images) to canvas
        renderBackground: function(ctx, element, width, height) {
            const styles = window.getComputedStyle(element);
            
            // Fill with background color first
            if (styles.backgroundColor !== 'transparent' && styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                ctx.fillStyle = styles.backgroundColor;
                ctx.fillRect(0, 0, width, height);
            }
            
            // Handle background images
            const bgImage = styles.backgroundImage;
            if (bgImage && bgImage !== 'none' && !bgImage.includes('gradient')) {
                // Extract image URL
                const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
                if (urlMatch) {
                    const imageUrl = urlMatch[1];
                    // For now, estimate background color from image (simplified approach)
                    // In a full implementation, we'd load and draw the actual image
                    ctx.fillStyle = this.estimateImageAverageColor(imageUrl);
                    ctx.fillRect(0, 0, width, height);
                }
            }
        },

        // Render text content to canvas
        renderTextContent: function(ctx, element, scale) {
            const styles = window.getComputedStyle(element);
            const text = element.textContent?.trim();
            
            if (text) {
                ctx.fillStyle = styles.color;
                ctx.font = `${parseInt(styles.fontSize) * scale}px ${styles.fontFamily}`;
                ctx.textBaseline = 'top';
                
                // Simple text rendering
                const maxWidth = ctx.canvas.width - 4;
                ctx.fillText(text.substring(0, 20), 2, 2, maxWidth);
            }
        },

        // Sample pixels from canvas
        sampleCanvasPixels: function(ctx, width, height, type) {
            try {
                const imageData = ctx.getImageData(0, 0, width, height);
                const data = imageData.data;
                
                const samples = [];
                const sampleCount = Math.min(20, width * height / 4); // Sample up to 20 pixels
                
                for (let i = 0; i < sampleCount; i++) {
                    // Sample from different areas
                    const x = Math.floor((i % 5) * width / 5) + Math.floor(width / 10);
                    const y = Math.floor(Math.floor(i / 5) * height / 4) + Math.floor(height / 8);
                    const index = (y * width + x) * 4;
                    
                    if (index < data.length - 3) {
                        samples.push({
                            r: data[index],
                            g: data[index + 1], 
                            b: data[index + 2],
                            a: data[index + 3] / 255
                        });
                    }
                }
                
                if (samples.length === 0) return null;
                
                // Return average color
                const avg = this.averageColor(samples);
                return `rgba(${avg.r}, ${avg.g}, ${avg.b}, ${avg.a})`;
                
            } catch (e) {
                console.warn('Error sampling canvas pixels:', e);
                return null;
            }
        },

        // Estimate average color from image URL (simplified)
        estimateImageAverageColor: function(imageUrl) {
            // Simple heuristic based on common image types and naming
            const url = imageUrl.toLowerCase();
            
            if (url.includes('dark') || url.includes('black')) {
                return 'rgb(40, 40, 40)';
            } else if (url.includes('light') || url.includes('white')) {
                return 'rgb(240, 240, 240)';
            } else if (url.includes('hero') || url.includes('banner')) {
                return 'rgb(100, 100, 120)'; // Assume darker hero images
            }
            
            // Default to neutral gray
            return 'rgb(128, 128, 128)';
        },

        // DOM-based color sampling for simple backgrounds
        domBasedColorSampling: function(element) {
            try {
                // Create temporary elements to help with color sampling
                const tempTextSpan = document.createElement('span');
                const tempBgDiv = document.createElement('div');
                
                // Clone text content for foreground sampling
                tempTextSpan.textContent = element.textContent?.charAt(0) || 'A';
                tempTextSpan.style.cssText = `
                    position: absolute;
                    left: -9999px;
                    font: ${window.getComputedStyle(element).font};
                    color: ${window.getComputedStyle(element).color};
                    background: transparent;
                    border: none;
                    padding: 0;
                    margin: 0;
                `;
                
                // Create background sample
                tempBgDiv.style.cssText = `
                    position: absolute;
                    left: -9999px;
                    width: 10px;
                    height: 10px;
                    background: ${window.getComputedStyle(element).background};
                    border: none;
                    padding: 0;
                    margin: 0;
                `;
                
                document.body.appendChild(tempTextSpan);
                document.body.appendChild(tempBgDiv);
                
                // Get the actual rendered colors
                const textStyles = window.getComputedStyle(tempTextSpan);
                const bgStyles = window.getComputedStyle(tempBgDiv);
                
                const result = {
                    foreground: textStyles.color,
                    background: bgStyles.backgroundColor !== 'rgba(0, 0, 0, 0)' ? 
                        bgStyles.backgroundColor : 
                        this.findEffectiveBackground(element),
                    method: 'dom-sampling'
                };
                
                // Clean up
                document.body.removeChild(tempTextSpan);
                document.body.removeChild(tempBgDiv);
                
                return result;
            } catch (e) {
                console.warn('Error in DOM sampling:', e);
                return null;
            }
        },

        // Find effective background by examining actual DOM hierarchy
        findEffectiveBackground: function(element) {
            let current = element;
            while (current && current !== document.body) {
                const styles = window.getComputedStyle(current);
                const bg = styles.backgroundColor;
                
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                    return bg;
                }
                
                // Check for background images or gradients. Skip decorative thin
                // backgrounds (fake underlines via background-size: ... 2px) —
                // they aren't really behind the text, so keep walking up.
                if (styles.backgroundImage !== 'none' && !this.isDecorativeThinBackground(styles)) {
                    // For images/gradients, we'll estimate based on common patterns
                    return this.estimateBackgroundFromImage(styles);
                }
                
                current = current.parentElement;
            }
            
            // Default to white
            return 'rgb(255, 255, 255)';
        },

        // Estimate background color from background image (simple heuristics)
        estimateBackgroundFromImage: function(styles) {
            const bgImage = styles.backgroundImage;

            // Check for gradients
            if (bgImage.includes('gradient')) {
                // Extract first color from gradient
                const colorMatch = bgImage.match(/rgba?\([^)]+\)|#[a-fA-F0-9]{3,6}|\b\w+\b/);
                if (colorMatch) {
                    return colorMatch[0];
                }
            }

            // For other images, assume a neutral background
            return 'rgb(240, 240, 240)';
        },

        // Analyze a CSS gradient background to find the worst-case contrast position.
        // Extracts all explicit color stops, interpolates midpoints between each pair,
        // Return all <img> elements whose rendered bounding box overlaps the given element.
        // Used to detect text that is CSS-positioned on top of an image.
        findOverlappingImages: function(element) {
            try {
                const rect = element.getBoundingClientRect();
                if (rect.width < 1 || rect.height < 1) return [];

                const results = [];
                document.querySelectorAll('img').forEach(img => {
                    // Exclude images that are part of the checker UI
                    if (img.closest('#uw-a11y-container')) return;
                    const ir = img.getBoundingClientRect();
                    if (rect.right > ir.left && rect.left < ir.right &&
                        rect.bottom > ir.top  && rect.top  < ir.bottom) {
                        results.push(img);
                    }
                });
                return results;
            } catch (e) {
                return [];
            }
        },

        // Sample the average rendered pixel color of the region where an <img>
        // overlaps the given element. Works for data: URIs and same-origin images.
        // Returns an rgb() string on success, null if the image is cross-origin
        // (canvas tainted) or not yet loaded.
        sampleImagePixelsAtElement: function(img, element) {
            try {
                if (!img.complete || img.naturalWidth === 0) return null;

                const elRect  = element.getBoundingClientRect();
                const imgRect = img.getBoundingClientRect();

                // Overlap region in viewport coords
                const ol = Math.max(elRect.left,   imgRect.left);
                const ot = Math.max(elRect.top,    imgRect.top);
                const or_ = Math.min(elRect.right,  imgRect.right);
                const ob  = Math.min(elRect.bottom, imgRect.bottom);
                if (or_ <= ol || ob <= ot) return null;

                // Map overlap region to natural image pixel coords
                const scaleX = img.naturalWidth  / (imgRect.width  || 1);
                const scaleY = img.naturalHeight / (imgRect.height || 1);
                const srcX = Math.round((ol  - imgRect.left) * scaleX);
                const srcY = Math.round((ot  - imgRect.top)  * scaleY);
                const srcW = Math.max(1, Math.round((or_ - ol) * scaleX));
                const srcH = Math.max(1, Math.round((ob  - ot) * scaleY));

                const canvas = document.createElement('canvas');
                canvas.width  = srcW;
                canvas.height = srcH;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

                // getImageData throws SecurityError for cross-origin (tainted) canvases
                const data = ctx.getImageData(0, 0, srcW, srcH).data;
                let totalR = 0, totalG = 0, totalB = 0;
                const px = srcW * srcH;
                for (let i = 0; i < data.length; i += 4) {
                    totalR += data[i]; totalG += data[i + 1]; totalB += data[i + 2];
                }
                return `rgb(${Math.round(totalR / px)}, ${Math.round(totalG / px)}, ${Math.round(totalB / px)})`;
            } catch (e) {
                // SecurityError = cross-origin image, or image not yet decoded
                return null;
            }
        },

        // then returns the stop that produces the LOWEST contrast against fgColor
        // (i.e. the hardest-to-read position on the gradient per WCAG intent).
        analyzeGradientBackground: function(gradientCss, fgColor, textEl, gradEl) {
            try {
                // Pull every color token out of the gradient string.
                // Matches: rgb(...), rgba(...), #rrggbb, #rgb, named keywords.
                const colorPattern = /(rgba?\(\s*[\d.,\s/]+\)|#[0-9a-f]{3,8})/gi;
                const rawStops = gradientCss.match(colorPattern) || [];
                if (rawStops.length === 0) return null;

                // Parse a color token into { r, g, b }, respecting alpha.
                // Near-transparent stops (alpha < 0.15) are discarded — they are
                // essentially invisible and should not influence contrast analysis.
                // A common pattern is linear-gradient(rgba(R,G,B,0.9), rgba(R,G,B,0))
                // where the transparent end is just a fade-to-image; treating it as
                // a solid colour produces wildly wrong contrast values.
                const parseRgb = (color) => {
                    const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
                    if (m) {
                        const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
                        if (alpha < 0.15) return null; // skip near-transparent stops
                        return { r: +m[1], g: +m[2], b: +m[3] };
                    }
                    // hex
                    const hex = color.replace('#', '');
                    if (hex.length === 3) return {
                        r: parseInt(hex[0]+hex[0], 16),
                        g: parseInt(hex[1]+hex[1], 16),
                        b: parseInt(hex[2]+hex[2], 16)
                    };
                    if (hex.length === 6) return {
                        r: parseInt(hex.slice(0,2), 16),
                        g: parseInt(hex.slice(2,4), 16),
                        b: parseInt(hex.slice(4,6), 16)
                    };
                    return null;
                };

                const stopColors = rawStops.map(parseRgb).filter(Boolean);
                if (stopColors.length === 0) return null;

                // Build sample set: every explicit stop + midpoint between each pair.
                let samples = [...stopColors];
                for (let i = 0; i < stopColors.length - 1; i++) {
                    const a = stopColors[i], b = stopColors[i + 1];
                    samples.push({
                        r: Math.round((a.r + b.r) / 2),
                        g: Math.round((a.g + b.g) / 2),
                        b: Math.round((a.b + b.b) / 2)
                    });
                }

                // ── Positional filtering ──────────────────────────────────────────
                // When the gradient lives on an ancestor element (e.g. a row that
                // spans both a dark icon circle and light text), sampling ALL stops
                // produces false positives: the worst stop may belong to a region the
                // text never actually overlaps. We compute the text element's center
                // as a fraction [0,1] of the gradient element in the primary axis,
                // then only sample color stops within ±25% of that position.
                if (textEl && gradEl && stopColors.length > 1) {
                    try {
                        const textRect = textEl.getBoundingClientRect();
                        const gradRect = gradEl.getBoundingClientRect();
                        const gw = gradRect.width, gh = gradRect.height;

                        if (gw > 0 && gh > 0) {
                            // Detect primary gradient axis from keyword or angle.
                            const isHorizontal =
                                /to right|to left|\b90deg\b|\b270deg\b|-90deg/i.test(gradientCss);
                            const isVertical =
                                /to bottom|to top|\b0deg\b|\b180deg\b/i.test(gradientCss);

                            let fraction;
                            if (isHorizontal) {
                                fraction = ((textRect.left + textRect.right) / 2 - gradRect.left) / gw;
                            } else if (isVertical || gh >= gw) {
                                fraction = ((textRect.top + textRect.bottom) / 2 - gradRect.top) / gh;
                            } else {
                                // Diagonal or unknown — use horizontal as best guess
                                fraction = ((textRect.left + textRect.right) / 2 - gradRect.left) / gw;
                            }
                            fraction = Math.max(0, Math.min(1, fraction));

                            const window = 0.25; // ±25% positional tolerance
                            const minFrac = Math.max(0, fraction - window);
                            const maxFrac = Math.min(1, fraction + window);

                            // Map stop index → normalised position (0 = first, 1 = last)
                            const filtered = stopColors.filter((_, i) => {
                                const pos = stopColors.length === 1 ? 0.5 : i / (stopColors.length - 1);
                                return pos >= minFrac && pos <= maxFrac;
                            });

                            // Also add the interpolated color at the exact text center
                            const fracIdx = fraction * (stopColors.length - 1);
                            const lo = Math.floor(fracIdx), hi = Math.ceil(fracIdx);
                            if (lo < stopColors.length && hi < stopColors.length) {
                                const t = fracIdx - lo;
                                filtered.push({
                                    r: Math.round(stopColors[lo].r * (1 - t) + stopColors[hi].r * t),
                                    g: Math.round(stopColors[lo].g * (1 - t) + stopColors[hi].g * t),
                                    b: Math.round(stopColors[lo].b * (1 - t) + stopColors[hi].b * t),
                                });
                            }

                            if (filtered.length > 0) {
                                samples = filtered;
                            }
                        }
                    } catch (_) {
                        // If positional filtering fails, fall through to full sampling
                    }
                }

                const fgLum = this.getLuminance(fgColor);
                if (fgLum === null) return null;

                let minContrast = Infinity;
                let worstColor = null;

                for (const s of samples) {
                    const sColor = `rgb(${s.r}, ${s.g}, ${s.b})`;
                    const sLum = this.getLuminance(sColor);
                    if (sLum === null) continue;
                    const lighter = Math.max(fgLum, sLum);
                    const darker  = Math.min(fgLum, sLum);
                    const ratio   = (lighter + 0.05) / (darker + 0.05);
                    if (ratio < minContrast) {
                        minContrast = ratio;
                        worstColor  = sColor;
                    }
                }

                if (!worstColor || minContrast === Infinity) return null;

                return {
                    foreground:    fgColor,
                    background:    worstColor,   // worst-case gradient position within text's region
                    contrastRatio: minContrast,
                    sampleCount:   samples.length
                };
            } catch (e) {
                return null;
            }
        },

        // Determine if pixel analysis is more reliable than computed styles
        isPixelAnalysisMoreReliable: function(colorSamples, computedStyles) {
            // Pixel analysis is more reliable when:
            // 1. Computed styles show transparency that we resolved
            // 2. There's a significant difference in calculated contrast
            // 3. We detected complex backgrounds
            
            const computedBg = computedStyles.backgroundColor;
            const computedFg = computedStyles.color;
            
            // If computed styles show transparency, pixel analysis is likely better
            if (computedBg === 'rgba(0, 0, 0, 0)' || computedBg === 'transparent') {
                return true;
            }
            
            // If foreground has transparency, pixel analysis handles blending better
            if (computedFg.includes('rgba') && this.getAlphaFromRgba(computedFg) < 0.9) {
                return true;
            }
            
            // Compare contrast ratios
            const computedContrast = this.calculateContrastRatio(computedFg, computedBg);
            const sampledContrast = this.calculateContrastRatio(colorSamples.foreground, colorSamples.background);
            
            // If sampling gives us a significantly different result, trust it
            if (computedContrast && sampledContrast) {
                const difference = Math.abs(computedContrast - sampledContrast);
                return difference > 1; // Significant difference in contrast ratio
            }
            
            return false;
        },

        // Determine if a contrast manual review item should be skipped because pixel analysis shows sufficient contrast
        shouldSkipContrastManualReview: function(axeRule, node) {
            // Only apply to contrast-related rules
            const contrastRules = ['color-contrast', 'color-contrast-enhanced'];
            if (!contrastRules.includes(axeRule.id)) {
                return false;
            }

            try {
                const element = this.getElementFromNode(node);
                if (!element) return false;

                // Get enhanced color info with pixel analysis
                const colorInfo = this.extractColorContrastInfo(node);
                if (!colorInfo || !colorInfo.contrast || colorInfo.contrast === 'Unable to calculate') {
                    return false;
                }

                // Parse contrast ratio
                const contrastValue = parseFloat(colorInfo.contrast.split(':')[0]);
                if (isNaN(contrastValue)) {
                    return false;
                }

                // Determine if this element needs enhanced (AAA) contrast
                const isEnhanced = axeRule.id === 'color-contrast-enhanced';
                
                // Check font size to determine if it's "large text"
                const isLargeText = this.isLargeText(element);
                
                // WCAG contrast requirements
                let requiredContrast;
                if (isEnhanced) {
                    // AAA requirements
                    requiredContrast = isLargeText ? 4.5 : 7.0;
                } else {
                    // AA requirements  
                    requiredContrast = isLargeText ? 3.0 : 4.5;
                }

                // Only skip manual review if we have significantly better contrast than required
                // Use a buffer to account for measurement variations
                const contrastBuffer = 0.3;
                const meetsRequirement = contrastValue >= (requiredContrast + contrastBuffer);

                if (meetsRequirement && (colorInfo.analysisMethod === 'pixel-analysis' || colorInfo.analysisMethod === 'dom-compositing' || colorInfo.analysisMethod === 'gradient-analysis' || colorInfo.analysisMethod === 'image-pixel-sampling')) {
                    console.log(`Auto-resolving contrast issue for element:`, {
                        selector: node.target?.join(' '),
                        measured: contrastValue,
                        required: requiredContrast,
                        isLargeText: isLargeText,
                        analysisMethod: colorInfo.analysisMethod
                    });
                    return true;
                }

                return false;
            } catch (e) {
                console.warn('Error checking contrast for auto-resolution:', e);
                return false;
            }
        },

        // Determine if a contrast violation should be skipped because pixel analysis shows sufficient contrast
        shouldSkipContrastViolation: function(axeRule, node) {
            // Only apply to contrast-related rules
            const contrastRules = ['color-contrast', 'color-contrast-enhanced'];
            if (!contrastRules.includes(axeRule.id)) {
                return false;
            }

            try {
                const element = this.getElementFromNode(node);
                if (!element) return false;

                // Get enhanced color info with pixel analysis
                const colorInfo = this.extractColorContrastInfo(node);
                if (!colorInfo || !colorInfo.contrast || colorInfo.contrast === 'Unable to calculate') {
                    return false;
                }

                // Parse contrast ratio
                const contrastValue = parseFloat(colorInfo.contrast.split(':')[0]);
                if (isNaN(contrastValue)) {
                    return false;
                }

                // Determine if this element needs enhanced (AAA) contrast
                const isEnhanced = axeRule.id === 'color-contrast-enhanced';
                
                // Check font size to determine if it's "large text"
                const isLargeText = this.isLargeText(element);
                
                // WCAG contrast requirements
                let requiredContrast;
                if (isEnhanced) {
                    // AAA requirements
                    requiredContrast = isLargeText ? 4.5 : 7.0;
                } else {
                    // AA requirements  
                    requiredContrast = isLargeText ? 3.0 : 4.5;
                }

                // Only skip violation if we have significantly better contrast than required
                // Use a buffer to account for measurement variations
                const contrastBuffer = 0.3;
                const meetsRequirement = contrastValue >= (requiredContrast + contrastBuffer);

                if (meetsRequirement && (colorInfo.analysisMethod === 'pixel-analysis' || colorInfo.analysisMethod === 'dom-compositing' || colorInfo.analysisMethod === 'gradient-analysis' || colorInfo.analysisMethod === 'image-pixel-sampling')) {
                    console.log(`Auto-resolving contrast violation for element:`, {
                        selector: node.target?.join(' '),
                        measured: contrastValue,
                        required: requiredContrast,
                        isLargeText: isLargeText,
                        analysisMethod: colorInfo.analysisMethod
                    });
                    return true;
                }

                return false;
            } catch (e) {
                console.warn('Error checking contrast violation for auto-resolution:', e);
                return false;
            }
        },

        // Determine if an axe-core "incomplete" (manual review) contrast item should be
        // escalated to a definite error because the checker can measure a ratio that
        // clearly fails WCAG. Two escalation paths:
        //   1. Trusted methods (gradient-analysis, dom-compositing, pixel-analysis):
        //      escalate when ratio < required - 0.3 buffer.
        //   2. Computed-style walk-up: escalate only when ratio < 2.0, which catches
        //      obvious same-colour-on-same-colour failures (e.g. white-on-white = 1:1)
        //      with minimal false-positive risk.
        shouldEscalateContrastToError: function(axeRule, node) {
            const contrastRules = ['color-contrast', 'color-contrast-enhanced'];
            if (!contrastRules.includes(axeRule.id)) return false;

            try {
                const element = this.getElementFromNode(node);
                if (!element) return false;

                const colorInfo = this.extractColorContrastInfo(node);
                if (!colorInfo || !colorInfo.contrast || colorInfo.contrast === 'Unable to calculate') return false;

                // If the element sits over a cross-origin image we couldn't pixel-sample,
                // the background color is just a guess — never escalate to a hard error.
                if (colorInfo.overlapsUnsampledImage) return false;

                const contrastValue = parseFloat(colorInfo.contrast.split(':')[0]);
                if (isNaN(contrastValue)) return false;

                const isEnhanced = axeRule.id === 'color-contrast-enhanced';
                const isLargeText = this.isLargeText(element);
                const requiredContrast = isEnhanced
                    ? (isLargeText ? 4.5 : 7.0)
                    : (isLargeText ? 3.0 : 4.5);

                const isTrustedMethod = ['pixel-analysis', 'dom-compositing', 'gradient-analysis', 'image-pixel-sampling']
                    .includes(colorInfo.analysisMethod);

                if (isTrustedMethod) {
                    // Trusted measurement — escalate if it clearly fails (with a buffer)
                    return contrastValue < (requiredContrast - 0.3);
                } else {
                    // Computed-style walk-up — only escalate on extreme failures (≤ 2:1)
                    // to avoid false positives from ancestor-background mismatches
                    return contrastValue <= 2.0;
                }
            } catch (e) {
                return false;
            }
        },

        // Check if element has large text (per WCAG definition)
        isLargeText: function(element) {
            const styles = window.getComputedStyle(element);
            const fontSize = parseFloat(styles.fontSize);
            const fontWeight = styles.fontWeight;
            
            // WCAG large text: 18pt+ (24px+) or 14pt+ (18.5px+) bold
            // Note: 1pt ≈ 1.33px at 96 DPI
            const isLarge = fontSize >= 24; // 18pt+
            const isBoldAndMedium = (fontSize >= 18.5) && 
                (fontWeight === 'bold' || fontWeight === '700' || parseInt(fontWeight) >= 700);
                
            return isLarge || isBoldAndMedium;
        },

        // Toggle focus indicators visualization
        toggleFocusIndicatorsVisualization: function() {
            const isActive = this.isFocusIndicatorsActive || false;
            const newState = !isActive;
            
            // Update state first
            this.isFocusIndicatorsActive = newState;
            
            if (newState) {
                this.showFocusIndicatorsVisualization();
            } else {
                this.hideFocusIndicatorsVisualization();
            }
            
            // Update button state
            const focusIndicatorsBtn = this.shadowRoot.getElementById('uw-a11y-focus-indicators-toggle');
            const focusIndicatorsCount = this.shadowRoot.getElementById('uw-a11y-focus-indicators-count');
            
            
            if (focusIndicatorsBtn) {
                focusIndicatorsBtn.setAttribute('aria-pressed', String(newState));
                
                // Get the icons and text
                const targetIcon = focusIndicatorsBtn.querySelector('.feather-target');
                const eyeOffIcon = focusIndicatorsBtn.querySelector('.feather-eye-off');
                const btnText = focusIndicatorsBtn.querySelector('.uw-a11y-btn-text');
                
                
                if (newState) {
                    // Activating focus indicators - show "Hide" state
                    focusIndicatorsBtn.classList.add('active');
                    
                    // Switch icons
                    if (targetIcon) targetIcon.style.display = 'none';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'inline';
                    
                    // Update text
                    if (btnText) btnText.textContent = 'Hide Focus Preview';
                    
                    // Show count
                    if (focusIndicatorsCount) {
                        focusIndicatorsCount.style.display = 'inline';
                    }
                } else {
                    // Deactivating focus indicators - show "Show" state
                    focusIndicatorsBtn.classList.remove('active');
                    
                    // Switch icons
                    if (targetIcon) targetIcon.style.display = 'inline';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'none';
                    
                    // Update text
                    if (btnText) btnText.textContent = 'Preview Focus Styles';
                    
                    // Hide count
                    if (focusIndicatorsCount) {
                        focusIndicatorsCount.style.display = 'none';
                    }
                }
            }
        },

        // Show focus indicators visualization
        showFocusIndicatorsVisualization: function() {
            this.hideFocusIndicatorsVisualization();
            
            const focusableElements = this.getFocusableElements();
            this.cachedFocusableElements = focusableElements;
            
            // Apply simulated focus styles to all focusable elements
            this.injectFocusSimulationStyles();
            
            focusableElements.forEach(element => {
                // Add a class that will trigger the focus styles
                element.classList.add('uw-a11y-simulated-focus');
                element.setAttribute('data-uw-a11y-focus-preview', 'true');
            });
            
            // Set up event handlers for scroll/resize
            this.setupFocusIndicatorsEventHandlers();
            
            // Update status
            const totalFocusable = focusableElements.length;
            const focusIndicatorsCount = this.shadowRoot.getElementById('uw-a11y-focus-indicators-count');
            if (focusIndicatorsCount) {
                focusIndicatorsCount.textContent = `Previewing focus styles on ${totalFocusable} focusable elements`;
            }
            
            console.log(`Focus preview: Showing focus styles on ${totalFocusable} focusable elements`);
        },

        // Hide focus indicators visualization
        hideFocusIndicatorsVisualization: function() {
            // Remove simulated focus classes from all elements
            if (this.cachedFocusableElements) {
                this.cachedFocusableElements.forEach(element => {
                    element.classList.remove('uw-a11y-simulated-focus');
                    element.removeAttribute('data-uw-a11y-focus-preview');
                });
            }
            
            // Also clean up any elements that might have been missed
            document.querySelectorAll('.uw-a11y-simulated-focus').forEach(element => {
                element.classList.remove('uw-a11y-simulated-focus');
                element.removeAttribute('data-uw-a11y-focus-preview');
            });
            
            this.cachedFocusableElements = null;
            this.cleanupFocusIndicatorsEventHandlers();
            
            // Remove the focus simulation styles
            this.removeFocusSimulationStyles();
        },



        // Set up event handlers for focus indicators
        setupFocusIndicatorsEventHandlers: function() {
            // For the new focus simulation approach, we don't need scroll/resize handlers
            // since the focus styles move with the elements naturally
            // This function is kept for potential future enhancements
        },

        // Clean up focus indicators event handlers
        cleanupFocusIndicatorsEventHandlers: function() {
            // Cleanup for future use - currently no handlers to remove
        },

        // Inject focus simulation styles
        injectFocusSimulationStyles: function() {
            if (document.getElementById('uw-a11y-focus-simulation-styles')) return;
            
            const style = document.createElement('style');
            style.id = 'uw-a11y-focus-simulation-styles';
            style.textContent = `
                /* Force focus styles to be visible on all elements with the simulation class */
                .uw-a11y-simulated-focus:focus,
                .uw-a11y-simulated-focus {
                    /* Apply default focus outline if none exists */
                    outline: 2px solid #0066cc !important;
                    outline-offset: 2px !important;
                }
                
                /* For elements that already have custom focus styles, enhance them */
                .uw-a11y-simulated-focus:focus {
                    /* Let existing focus styles show through, but ensure they're visible */
                    position: relative;
                }
                
                /* Special handling for different element types */
                input.uw-a11y-simulated-focus,
                textarea.uw-a11y-simulated-focus,
                select.uw-a11y-simulated-focus {
                    /* Form elements get a blue outline */
                    outline: 2px solid #0066cc !important;
                    outline-offset: 1px !important;
                }
                
                button.uw-a11y-simulated-focus,
                [role="button"].uw-a11y-simulated-focus {
                    /* Buttons get a distinctive style */
                    outline: 2px solid #0066cc !important;
                    outline-offset: 2px !important;
                }
                
                a.uw-a11y-simulated-focus {
                    /* Links get their own style */
                    outline: 2px solid #0066cc !important;
                    outline-offset: 2px !important;
                }
                
                /* Override any outline: none declarations */
                .uw-a11y-simulated-focus[style*="outline: none"],
                .uw-a11y-simulated-focus[style*="outline:none"] {
                    outline: 2px solid #ff6b35 !important;
                    outline-offset: 2px !important;
                    box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.3) !important;
                }
                
                /* Add a subtle animation to show the simulation is active */
                .uw-a11y-simulated-focus {
                    animation: uw-a11y-focus-simulation-pulse 2s ease-in-out infinite;
                }
                
                @keyframes uw-a11y-focus-simulation-pulse {
                    0%, 100% {
                        outline-color: #0066cc;
                    }
                    50% {
                        outline-color: #4d9eff;
                    }
                }
                
                /* For elements that have been explicitly hidden or have outline:none */
                .uw-a11y-simulated-focus[tabindex="-1"] {
                    outline: 2px dashed #999 !important;
                    outline-offset: 2px !important;
                }
            `;
            
            document.head.appendChild(style);
        },

        // Remove focus simulation styles
        removeFocusSimulationStyles: function() {
            const style = document.getElementById('uw-a11y-focus-simulation-styles');
            if (style) {
                style.remove();
            }
        },

        // Toggle landmark structure visualization
        toggleLandmarkStructureVisualization: function() {
            const isActive = this.isLandmarkStructureActive || false;
            const newState = !isActive;
            
            // Update state first
            this.isLandmarkStructureActive = newState;
            
            if (newState) {
                this.showLandmarkStructureVisualization();
            } else {
                this.hideLandmarkStructureVisualization();
            }
            
            // Update button state
            const landmarkBtn = this.shadowRoot.getElementById('uw-a11y-landmark-structure-toggle');
            const landmarkCount = this.shadowRoot.getElementById('uw-a11y-landmark-structure-count');
            
            if (landmarkBtn) {
                landmarkBtn.setAttribute('aria-pressed', String(newState));
                
                // Get the icons and text
                const mapIcon = landmarkBtn.querySelector('.feather-map');
                const eyeOffIcon = landmarkBtn.querySelector('.feather-eye-off');
                const btnText = landmarkBtn.querySelector('.uw-a11y-btn-text');
                
                if (newState) {
                    // Activating landmark structure - show "Hide" state
                    landmarkBtn.classList.add('active');
                    
                    // Switch icons
                    if (mapIcon) mapIcon.style.display = 'none';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'inline';
                    
                    // Update text
                    if (btnText) btnText.textContent = 'Hide Landmarks';
                    
                    // Show count
                    if (landmarkCount) {
                        landmarkCount.style.display = 'inline';
                    }
                } else {
                    // Deactivating landmark structure - show "Show" state
                    landmarkBtn.classList.remove('active');
                    
                    // Switch icons
                    if (mapIcon) mapIcon.style.display = 'inline';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'none';
                    
                    // Update text
                    if (btnText) btnText.textContent = 'Show Landmarks';
                    
                    // Hide count
                    if (landmarkCount) {
                        landmarkCount.style.display = 'none';
                    }
                }
            }
        },

        // Show landmark structure visualization
        showLandmarkStructureVisualization: function() {
            this.hideLandmarkStructureVisualization();
            
            const landmarks = this.detectLandmarks();
            const headings = this.detectHeadings();
            
            this.cachedLandmarks = landmarks;
            this.cachedHeadings = headings;
            
            // Create overlay container
            const overlay = document.createElement('div');
            overlay.className = 'uw-a11y-landmark-overlay';
            overlay.setAttribute('data-uw-a11y-overlay', 'true');
            
            // Add landmark indicators
            landmarks.forEach((landmark, index) => {
                const indicator = this.createLandmarkIndicator(landmark, index + 1);
                if (indicator) {
                    const delay = Math.min(50 * index, 1000);
                    indicator.style.animationDelay = `${delay}ms`;
                    overlay.appendChild(indicator);
                }
            });
            
            // Add heading indicators
            headings.forEach((heading, index) => {
                const indicator = this.createHeadingIndicator(heading, index + 1);
                if (indicator) {
                    const delay = Math.min(30 * index + 200, 1500);
                    indicator.style.animationDelay = `${delay}ms`;
                    overlay.appendChild(indicator);
                }
            });
            
            document.body.appendChild(overlay);
            this.injectLandmarkStructureStyles();
            this.landmarkStructureOverlay = overlay;
            
            // Set up event handlers for scroll/resize
            this.setupLandmarkStructureEventHandlers();
            
            // Update status
            const totalElements = landmarks.length + headings.length;
            const landmarkCount = this.shadowRoot.getElementById('uw-a11y-landmark-structure-count');
            if (landmarkCount) {
                landmarkCount.textContent = `${landmarks.length} landmarks, ${headings.length} headings`;
            }
            
            console.log(`Landmark structure: Found ${landmarks.length} landmarks and ${headings.length} headings`);
        },

        // Hide landmark structure visualization
        hideLandmarkStructureVisualization: function() {
            if (this.landmarkStructureOverlay) {
                this.landmarkStructureOverlay.remove();
                this.landmarkStructureOverlay = null;
            }
            
            this.cachedLandmarks = null;
            this.cachedHeadings = null;
            this.cleanupLandmarkStructureEventHandlers();
            
            // Remove any existing overlays
            document.querySelectorAll('.uw-a11y-landmark-overlay').forEach(el => el.remove());
            this.removeLandmarkStructureStyles();
        },
        
        // Analyze landmark context
        analyzeLandmarkContext: function(node) {
            try {
                const element = this.getElementFromNode(node);
                if (!element) return 'Element not found';
                
                const landmarks = document.querySelectorAll('main, nav, header, footer, aside, section[aria-label], section[aria-labelledby], [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"]');
                
                return `Found ${landmarks.length} landmarks on page. Current element: ${element.tagName.toLowerCase()}${element.getAttribute('role') ? ' (role="' + element.getAttribute('role') + '")' : ''}`;
            } catch (e) {
                return 'Unable to analyze landmark context';
            }
        },

        // Detect landmarks on the page
        detectLandmarks: function() {
            const landmarks = [];
            
            // Define landmark selectors and their types
            const landmarkSelectors = [
                { selector: 'main, [role="main"]', type: 'main', label: 'main' },
                { selector: 'nav, [role="navigation"]', type: 'navigation', label: 'nav' },
                { selector: 'header, [role="banner"]', type: 'banner', label: 'header' },
                { selector: 'footer, [role="contentinfo"]', type: 'contentinfo', label: 'footer' },
                { selector: 'aside, [role="complementary"]', type: 'complementary', label: 'aside' },
                { selector: '[role="search"]', type: 'search', label: 'search' },
                { selector: '[role="form"]', type: 'form', label: 'form' },
                { selector: '[role="region"][aria-label], [role="region"][aria-labelledby]', type: 'region', label: 'region' },
                { selector: 'section[aria-label], section[aria-labelledby]', type: 'region', label: 'section' }
            ];
            
            landmarkSelectors.forEach(({ selector, type, label }) => {
                const elements = document.querySelectorAll(selector);
                elements.forEach((element, index) => {
                    // Skip our own UI elements
                    if (this.isOwnUIElement({ target: element })) {
                        return;
                    }
                    
                    const landmarkLabel = this.getLandmarkLabel(element);
                    landmarks.push({
                        element: element,
                        type: type,
                        label: label,
                        customLabel: landmarkLabel,
                        selector: selector
                    });
                });
            });
            
            return landmarks;
        },

        // Detect headings on the page
        detectHeadings: function() {
            const headings = [];
            const headingElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
            
            headingElements.forEach((element, index) => {
                // Skip our own UI elements
                if (this.isOwnUIElement({ target: element })) {
                    return;
                }
                
                const level = this.getHeadingLevel(element);
                const text = element.textContent.trim();
                
                headings.push({
                    element: element,
                    level: level,
                    text: text,
                    index: index + 1
                });
            });
            
            return headings;
        },

        // Get landmark label (aria-label or aria-labelledby)
        getLandmarkLabel: function(element) {
            const ariaLabel = element.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel;
            
            const ariaLabelledBy = element.getAttribute('aria-labelledby');
            if (ariaLabelledBy) {
                const labelElement = document.getElementById(ariaLabelledBy);
                if (labelElement) {
                    return labelElement.textContent.trim();
                }
            }
            
            return null;
        },

        // Get heading level
        getHeadingLevel: function(element) {
            if (element.tagName.match(/^H[1-6]$/)) {
                return parseInt(element.tagName.charAt(1));
            }
            
            const ariaLevel = element.getAttribute('aria-level');
            if (ariaLevel) {
                return parseInt(ariaLevel);
            }
            
            return 1; // Default level
        },

        // Create landmark indicator
        createLandmarkIndicator: function(landmark, index) {
            const rect = landmark.element.getBoundingClientRect();
            
            if (rect.width === 0 || rect.height === 0) {
                return null;
            }
            
            const indicator = document.createElement('div');
            indicator.className = 'uw-a11y-landmark-indicator';
            indicator.setAttribute('data-landmark-type', landmark.type);
            indicator.setAttribute('data-landmark-index', index);
            
            // Position the indicator
            const x = rect.left + window.scrollX;
            const y = rect.top + window.scrollY;
            
            indicator.style.position = 'absolute';
            indicator.style.left = `${x}px`;
            indicator.style.top = `${y}px`;
            indicator.style.width = `${rect.width}px`;
            indicator.style.height = `${rect.height}px`;
            indicator.style.zIndex = '999997';
            
            // Add landmark badge
            const badge = document.createElement('div');
            badge.className = 'uw-a11y-landmark-badge';
            badge.textContent = landmark.label;
            
            const title = `${landmark.label}${landmark.customLabel ? ': ' + landmark.customLabel : ''}`;
            badge.title = title;
            badge.setAttribute('aria-label', title);
            
            indicator.appendChild(badge);
            
            return indicator;
        },

        // Create heading indicator
        createHeadingIndicator: function(heading, index) {
            const rect = heading.element.getBoundingClientRect();
            
            if (rect.width === 0 || rect.height === 0) {
                return null;
            }
            
            const indicator = document.createElement('div');
            indicator.className = 'uw-a11y-heading-indicator';
            indicator.setAttribute('data-heading-level', heading.level);
            indicator.setAttribute('data-heading-index', index);
            
            // Position the indicator
            const x = rect.left + window.scrollX;
            const y = rect.top + window.scrollY;
            
            indicator.style.position = 'absolute';
            indicator.style.left = `${x}px`;
            indicator.style.top = `${y}px`;
            indicator.style.width = `${rect.width}px`;
            indicator.style.height = `${rect.height}px`;
            indicator.style.zIndex = '999996';
            
            // Add heading badge
            const badge = document.createElement('div');
            badge.className = 'uw-a11y-heading-badge';
            badge.textContent = `H${heading.level}`;
            
            const title = `Heading Level ${heading.level}: ${heading.text.substring(0, 100)}${heading.text.length > 100 ? '...' : ''}`;
            badge.title = title;
            badge.setAttribute('aria-label', title);
            
            indicator.appendChild(badge);
            
            return indicator;
        },

        // Set up event handlers for landmark structure
        setupLandmarkStructureEventHandlers: function() {
            if (this.landmarkStructureScrollHandler || this.landmarkStructureResizeHandler) return;
            
            // Throttled scroll handler
            let isScrolling = false;
            this.landmarkStructureScrollHandler = () => {
                if (!isScrolling && this.isLandmarkStructureActive && !this.isAnimating) {
                    isScrolling = true;
                    requestAnimationFrame(() => {
                        if (!this.isAnimating) {
                            this.updateLandmarkStructurePositions();
                        }
                        isScrolling = false;
                    });
                }
            };
            
            // Throttled resize handler
            let resizeTimeout;
            this.landmarkStructureResizeHandler = () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    if (this.isLandmarkStructureActive) {
                        this.showLandmarkStructureVisualization(); // Full refresh on resize
                    }
                }, 100);
            };
            
            window.addEventListener('scroll', this.landmarkStructureScrollHandler, { passive: true });
            window.addEventListener('resize', this.landmarkStructureResizeHandler);
        },

        // Clean up landmark structure event handlers
        cleanupLandmarkStructureEventHandlers: function() {
            if (this.landmarkStructureScrollHandler) {
                window.removeEventListener('scroll', this.landmarkStructureScrollHandler);
                this.landmarkStructureScrollHandler = null;
            }
            if (this.landmarkStructureResizeHandler) {
                window.removeEventListener('resize', this.landmarkStructureResizeHandler);
                this.landmarkStructureResizeHandler = null;
            }
        },

        // Update landmark structure positions on scroll
        updateLandmarkStructurePositions: function() {
            if (!this.landmarkStructureOverlay || (!this.cachedLandmarks && !this.cachedHeadings)) return;
            
            // Update landmark positions
            if (this.cachedLandmarks) {
                this.landmarkStructureOverlay.querySelectorAll('.uw-a11y-landmark-indicator').forEach((indicator, index) => {
                    const landmark = this.cachedLandmarks[index];
                    if (landmark && landmark.element && landmark.element.isConnected) {
                        const rect = landmark.element.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            const x = rect.left + window.scrollX;
                            const y = rect.top + window.scrollY;
                            indicator.style.left = `${x}px`;
                            indicator.style.top = `${y}px`;
                            indicator.style.width = `${rect.width}px`;
                            indicator.style.height = `${rect.height}px`;
                            indicator.style.display = 'block';
                        } else {
                            indicator.style.display = 'none';
                        }
                    } else {
                        indicator.style.display = 'none';
                    }
                });
            }
            
            // Update heading positions
            if (this.cachedHeadings) {
                this.landmarkStructureOverlay.querySelectorAll('.uw-a11y-heading-indicator').forEach((indicator, index) => {
                    const heading = this.cachedHeadings[index];
                    if (heading && heading.element && heading.element.isConnected) {
                        const rect = heading.element.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            const x = rect.left + window.scrollX;
                            const y = rect.top + window.scrollY;
                            indicator.style.left = `${x}px`;
                            indicator.style.top = `${y}px`;
                            indicator.style.width = `${rect.width}px`;
                            indicator.style.height = `${rect.height}px`;
                            indicator.style.display = 'block';
                        } else {
                            indicator.style.display = 'none';
                        }
                    } else {
                        indicator.style.display = 'none';
                    }
                });
            }
        },

        // Inject landmark structure styles
        injectLandmarkStructureStyles: function() {
            if (document.getElementById('uw-a11y-landmark-structure-styles')) return;
            
            const style = document.createElement('style');
            style.id = 'uw-a11y-landmark-structure-styles';
            style.textContent = `
                .uw-a11y-landmark-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    pointer-events: none;
                    z-index: 999995;
                    width: 100%;
                    height: 100%;
                }
                
                .uw-a11y-landmark-indicator {
                    position: absolute;
                    border: 2px solid #007bff;
                    background-color: rgba(0, 123, 255, 0.1);
                    border-radius: 4px;
                    pointer-events: none;
                    animation: uw-a11y-landmark-appear 0.6s ease-out;
                    transition: all 0.2s ease-out;
                }
                
                .uw-a11y-heading-indicator {
                    position: absolute;
                    border: 2px solid #28a745;
                    background-color: rgba(40, 167, 69, 0.1);
                    border-radius: 3px;
                    pointer-events: none;
                    animation: uw-a11y-heading-appear 0.5s ease-out;
                    transition: all 0.2s ease-out;
                }
                
                .uw-a11y-landmark-badge {
                    position: absolute;
                    top: -12px;
                    left: -12px;
                    min-width: 24px;
                    height: 24px;
                    padding: 0 8px;
                    background: #007bff;
                    color: white;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: bold;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    border: 2px solid white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    z-index: 999998;
                    white-space: nowrap;
                }
                
                .uw-a11y-heading-badge {
                    position: absolute;
                    top: -10px;
                    right: -10px;
                    min-width: 20px;
                    height: 20px;
                    padding: 0 4px;
                    background: #28a745;
                    color: white;
                    border-radius: 3px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: bold;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    border: 2px solid white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    z-index: 999998;
                }
                
                /* Different colors for different landmark types */
                .uw-a11y-landmark-indicator[data-landmark-type="main"] {
                    border-color: #007bff;
                    background-color: rgba(0, 123, 255, 0.15);
                }
                .uw-a11y-landmark-indicator[data-landmark-type="main"] .uw-a11y-landmark-badge {
                    background: #007bff;
                }
                
                .uw-a11y-landmark-indicator[data-landmark-type="navigation"] {
                    border-color: #6f42c1;
                    background-color: rgba(111, 66, 193, 0.1);
                }
                .uw-a11y-landmark-indicator[data-landmark-type="navigation"] .uw-a11y-landmark-badge {
                    background: #6f42c1;
                }
                
                .uw-a11y-landmark-indicator[data-landmark-type="banner"] {
                    border-color: #e83e8c;
                    background-color: rgba(232, 62, 140, 0.1);
                }
                .uw-a11y-landmark-indicator[data-landmark-type="banner"] .uw-a11y-landmark-badge {
                    background: #e83e8c;
                }
                
                .uw-a11y-landmark-indicator[data-landmark-type="contentinfo"] {
                    border-color: #fd7e14;
                    background-color: rgba(253, 126, 20, 0.1);
                }
                .uw-a11y-landmark-indicator[data-landmark-type="contentinfo"] .uw-a11y-landmark-badge {
                    background: #fd7e14;
                }
                
                .uw-a11y-landmark-indicator[data-landmark-type="complementary"] {
                    border-color: #20c997;
                    background-color: rgba(32, 201, 151, 0.1);
                }
                .uw-a11y-landmark-indicator[data-landmark-type="complementary"] .uw-a11y-landmark-badge {
                    background: #20c997;
                }
                
                /* Different colors for different heading levels */
                .uw-a11y-heading-indicator[data-heading-level="1"] {
                    border-color: #dc3545;
                    background-color: rgba(220, 53, 69, 0.1);
                }
                .uw-a11y-heading-indicator[data-heading-level="1"] .uw-a11y-heading-badge {
                    background: #dc3545;
                }
                
                .uw-a11y-heading-indicator[data-heading-level="2"] {
                    border-color: #fd7e14;
                    background-color: rgba(253, 126, 20, 0.1);
                }
                .uw-a11y-heading-indicator[data-heading-level="2"] .uw-a11y-heading-badge {
                    background: #fd7e14;
                }
                
                .uw-a11y-heading-indicator[data-heading-level="3"] {
                    border-color: #ffc107;
                    background-color: rgba(255, 193, 7, 0.1);
                }
                .uw-a11y-heading-indicator[data-heading-level="3"] .uw-a11y-heading-badge {
                    background: #ffc107;
                    color: #212529;
                }
                
                .uw-a11y-heading-indicator[data-heading-level="4"],
                .uw-a11y-heading-indicator[data-heading-level="5"],
                .uw-a11y-heading-indicator[data-heading-level="6"] {
                    border-color: #28a745;
                    background-color: rgba(40, 167, 69, 0.1);
                }
                
                @keyframes uw-a11y-landmark-appear {
                    0% {
                        opacity: 0;
                        transform: scale(0.9);
                        border-width: 4px;
                    }
                    100% {
                        opacity: 1;
                        transform: scale(1);
                        border-width: 2px;
                    }
                }
                
                @keyframes uw-a11y-heading-appear {
                    0% {
                        opacity: 0;
                        transform: scale(0.8);
                    }
                    100% {
                        opacity: 1;
                        transform: scale(1);
                    }
                }
                
                .uw-a11y-landmark-indicator:hover,
                .uw-a11y-heading-indicator:hover {
                    z-index: 999999;
                    transform: scale(1.02);
                }
            `;
            
            document.head.appendChild(style);
        },

        // Remove landmark structure styles
        removeLandmarkStructureStyles: function() {
            const style = document.getElementById('uw-a11y-landmark-structure-styles');
            if (style) {
                style.remove();
            }
        },
        
        // Analyze heading structure
        analyzeHeadingStructure: function(node) {
            try {
                const element = this.getElementFromNode(node);
                if (!element) return 'Element not found';
                
                const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
                const currentIndex = headings.indexOf(element);
                const currentLevel = parseInt(element.tagName.charAt(1));
                
                let context = `Current: ${element.tagName} "${element.textContent.substring(0, 50)}"`;
                
                if (currentIndex > 0) {
                    const prevHeading = headings[currentIndex - 1];
                    const prevLevel = parseInt(prevHeading.tagName.charAt(1));
                    context += `\nPrevious: ${prevHeading.tagName} (level ${prevLevel})`;
                    
                    if (currentLevel > prevLevel + 1) {
                        context += `\nIssue: Skipped from H${prevLevel} to H${currentLevel}`;
                    }
                }
                
                return context;
            } catch (e) {
                return 'Unable to analyze heading structure';
            }
        },
        
        // Calculate accessibility score with per-rule caps (Lighthouse-like)
        // - Count each failed rule once (ignore instance count)
        // - Weight by impact; manual items deduct half if not verified
        // - Clamp any single rule’s impact so one type can’t dominate
        calculateAccessibilityScore: function(results) {
            if (!results) {
                return { score: 100, deductions: 0, maxPossible: 100, verifiedCount: 0, totalManualReview: 0 };
            }

            // Per-rule weights (approximate Lighthouse feel)
            const ruleWeights = {
                critical: 25,
                serious: 15,
                moderate: 8,
                minor: 3
            };

            // Per-category caps to avoid a single area dominating deductions
            // Keys use axe tag format (e.g., 'cat.color').
            const categoryCaps = {
                'cat.color': 5,
                'cat.keyboard': 15,
                'cat.name-role-value': 10,
                'cat.aria': 10,
                'cat.forms': 5,
                'cat.text-alternatives': 5,
                'cat.tables': 5,
                'cat.language': 5,
                'cat.structure': 5,
                'cat.audio-video': 5,
                // Non-axe-cat buckets
                'best-practice': 10,
                'other': 10
            };

            // Impact priority helper (to pick the highest when mixed)
            const impactRank = { critical: 4, serious: 3, moderate: 2, minor: 1 };
            const maxImpact = (a, b) => {
                const ia = impactRank[a] || 0;
                const ib = impactRank[b] || 0;
                return ia >= ib ? a : b;
            };

            // Helper to pick a category from axe tags
            const getCategory = (tags) => {
                const t = Array.isArray(tags) ? tags : [];
                const cat = t.find(x => typeof x === 'string' && x.startsWith('cat.'));
                if (cat) return cat;
                if (t.includes('best-practice')) return 'best-practice';
                return 'other';
            };

            // Build dismissed set once so both violations and manual-review loops can filter against it.
            // Dismissed group keys are stored as "<ruleId>-<type>" (e.g. "color-contrast-error").
            const dismissed = this.getDismissedIssues ? this.getDismissedIssues() : new Set();

            // 1) Violations: count per unique ruleId, weighted by highest impact observed, track category
            const violationMetaByRule = new Map(); // ruleId -> { impact, category }
            (results.violations || []).filter(v => !dismissed.has(`${v.id}-error`)).forEach(v => {
                const impact = (v.impact || 'moderate');
                const category = getCategory(v.tags);
                const prev = violationMetaByRule.get(v.id);
                if (prev) {
                    violationMetaByRule.set(v.id, { impact: maxImpact(prev.impact, impact), category: prev.category || category });
                } else {
                    violationMetaByRule.set(v.id, { impact, category });
                }
            });

            // Accumulate deductions per category
            const categoryDeductions = new Map();
            const addToCategory = (category, amount) => {
                const key = category || 'other';
                categoryDeductions.set(key, (categoryDeductions.get(key) || 0) + amount);
            };

            // 1b) Escalated errors: issues promoted from axe incomplete → error by our own analysis.
            // These never appear in results.violations so the loop above misses them entirely.
            // We treat them the same as violations (full weight, per-rule dedup).
            (this.issues || [])
                .filter(i => i.type === 'error' && i.escalated && !dismissed.has(`${i.ruleId}-error`))
                .forEach(issue => {
                    const ruleId = issue.ruleId;
                    if (violationMetaByRule.has(ruleId)) return; // already counted from violations
                    const impact = issue.impact || 'serious';
                    const category = getCategory(issue.tags);
                    violationMetaByRule.set(ruleId, { impact, category });
                });

            // Accumulate all violation deductions (real + escalated) into category buckets
            violationMetaByRule.forEach(({ impact, category }) => {
                const amount = (ruleWeights[impact] || ruleWeights.moderate);
                addToCategory(category, amount);
            });

            // 2) Manual review: per rule, deduct half weight only if any instance unverified
            // Keep counts for UI messaging
            let verifiedCount = 0;
            const manualIssues = (this.issues || []).filter(i =>
                i.type === 'warning' && i.uniqueId && !dismissed.has(`${i.ruleId}-warning`)
            );
            const totalManualReview = manualIssues.length;

            const manualByRule = new Map(); // ruleId -> { impact, unresolved, total, category }
            manualIssues.forEach(issue => {
                const ruleId = issue.ruleId;
                const impact = (issue.impact || 'moderate');
                const category = getCategory(issue.tags);
                const entry = manualByRule.get(ruleId) || { impact: impact, unresolved: 0, total: 0, category };
                entry.impact = maxImpact(entry.impact, impact);
                entry.total += 1;
                entry.category = entry.category || category;

                const ruleVerified = this.isRuleVerified(ruleId);
                const individuallyVerified = this.checkedItems && this.checkedItems.has(issue.uniqueId);
                if (individuallyVerified || ruleVerified) {
                    verifiedCount++;
                } else {
                    entry.unresolved += 1;
                }
                manualByRule.set(ruleId, entry);
            });

            manualByRule.forEach(({ impact, unresolved, category }) => {
                if (unresolved > 0) {
                    const amount = Math.round(((ruleWeights[impact] || ruleWeights.moderate) * 0.5));
                    addToCategory(category, amount);
                }
            });

            // 3) Apply per-category caps
            let totalDeductions = 0;
            categoryDeductions.forEach((amount, cat) => {
                const cap = categoryCaps[cat] != null ? categoryCaps[cat] : categoryCaps.other;
                totalDeductions += Math.min(amount, cap);
            });

            // 4) Compute final score from a 100-point budget
            const rawScore = 100 - totalDeductions;
            const score = Math.max(0, Math.min(100, Math.round(rawScore)));

            return {
                score: score,
                deductions: totalDeductions,
                maxPossible: 100,
                verifiedCount: verifiedCount,
                totalManualReview: totalManualReview,
                details: {
                    uniqueFailedRules: violationMetaByRule.size,
                    incomplete: (results.incomplete || []).length,
                    passes: (results.passes || []).length
                }
            };
        },
        
        // Show error message
        showError: function(message) {
            const panel = document.getElementById('uw-a11y-panel');
            if (panel) {
                const content = panel.querySelector('#uw-a11y-content');
                content.innerHTML = `
                    <div class="uw-a11y-issue error" style="margin: 1rem;">
                        <h4>Error Loading Accessibility Checker</h4>
                        <p>${message}</p>
                        <p><strong>Suggestions:</strong></p>
                        <ul>
                            <li>Check your internet connection</li>
                            <li>Try refreshing the page and running the bookmarklet again</li>
                            <li>Ensure your browser allows loading external scripts</li>
                        </ul>
                    </div>
                `;
            }
        },
        
        // Show score calculation explanation
        showScoreExplanation: function() {
            // Create a modal-like overlay
            const existing = this.shadowRoot.querySelector('.uw-a11y-score-explanation');
            if (existing) {
                existing.remove();
                return; // Toggle off if already shown
            }
            
            const overlay = document.createElement('div');
            overlay.className = 'uw-a11y-score-explanation';
            overlay.innerHTML = `
                <div class="uw-a11y-explanation-content">
                    <div class="uw-a11y-explanation-header">
                        <h3>How the Accessibility Score is Calculated</h3>
                        <button class="uw-a11y-explanation-close" aria-label="Close explanation">×</button>
                    </div>
                    <div class="uw-a11y-explanation-body">
                        <p>The accessibility score starts at 100 points and deducts points based on the severity and type of issues found:</p>
                        
                        <h4>Violation Deductions:</h4>
                        <ul>
                            <li><strong>Critical issues:</strong> -25 points per rule</li>
                            <li><strong>Serious issues:</strong> -15 points per rule</li>
                            <li><strong>Moderate issues:</strong> -8 points per rule</li>
                            <li><strong>Minor issues:</strong> -3 points per rule</li>
                        </ul>
                        
                        <h4>Manual Review Items:</h4>
                        <p>Items requiring human verification deduct <strong>half points</strong> if not manually verified or approved.</p>
                        
                        <h4>Category Caps:</h4>
                        <p>Each accessibility category (color, keyboard, forms, etc.) has a maximum deduction cap to prevent any single area from dominating the score.</p>
                        
                        <div class="uw-a11y-explanation-note">
                            <strong>Note:</strong> This scoring system is inspired by other axe-core tool scoring methodology and focuses on unique rule failures rather than individual element counts.
                        </div>
                    </div>
                </div>
            `;
            
            // Add to shadow root
            this.shadowRoot.appendChild(overlay);
            
            // Add event listeners
            const closeBtn = overlay.querySelector('.uw-a11y-explanation-close');
            const handleClose = () => overlay.remove();
            
            closeBtn.addEventListener('click', handleClose);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) handleClose();
            });
            
            // Handle keyboard events
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    handleClose();
                }
            });
            
            // Focus the close button for accessibility
            closeBtn.focus();
        },
        
        // Create and show the results panel
        createPanel: function() {
            this.shadowRoot.innerHTML = `
                ${this.getStyles()}
                <div id="uw-a11y-wrapper">
                <div id="uw-a11y-nav">
                    <nav>
                        <ul>
                            <li>
                                <a id="uw-a11y-nav-results" href="#uw-a11y-view-results" title="Results">
                                    <svg class="feather feather-pie-chart" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
                                    <span class="uw-a11y-nav-label">Results</span>
                                </a>
                            </li>
                            <li>
                                <a id="uw-a11y-nav-history" href="#uw-a11y-view-history" title="Score history">
                                    <svg class="feather feather-trending-up" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                                    <span class="uw-a11y-nav-label">History</span>
                                </a>
                            </li>
                            <li>
                                <a id="uw-a11y-nav-inspector" href="#uw-a11y-view-inspector" title="Inspector Tools">
                                    <svg class="feather feather-search" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                                    <span class="uw-a11y-nav-label">Inspector</span>
                                </a>
                            </li>
                            <li>
                                <a id="uw-a11y-nav-settings" href="#uw-a11y-view-settings" title="Settings">
                                    <svg class="feather feather-toggle-left" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><rect height="14" rx="7" ry="7" width="22" x="1" y="5"/><circle cx="8" cy="12" r="3"/></svg>
                                    <span class="uw-a11y-nav-label">Settings</span>
                                </a>
                            </li>
                            <li>
                                <a id="uw-a11y-nav-help" href="#uw-a11y-view-help" title="Help">
                                    <svg class="feather feather-alert-triangle" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                                    <span class="uw-a11y-nav-label">Help</span>
                                </a>
                            </li>
                            <li>
                                <a id="uw-a11y-nav-about" href="#uw-a11y-view-about" title="About">
                                    <svg class="feather feather-info" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/></svg>
                                    <span class="uw-a11y-nav-label">About</span>
                                </a>
                            </li>
                        </ul>
                    </nav>
                </div>
                <div id="uw-a11y-panel" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="uw-a11y-title">
                    <div class="accentcolors">
                        <div class="color1"></div>
                        <div class="color2"></div>
                        <div class="color3"></div>
                    </div>
                    <div id="uw-a11y-header">
                        <div class="uw-a11y-title-container">
                            <svg xmlns="http://www.w3.org/2000/svg" class="uw-a11y-logo" viewBox="0 0 404 404" fill="none" aria-hidden="true"><g filter="url(#a)"><path fill="url(#b)" fill-rule="evenodd" d="M201 349c87.261 0 158-70.739 158-158S288.261 33 201 33 43 103.739 43 191s70.739 158 158 158Zm0 24c100.516 0 182-81.484 182-182S301.516 9 201 9 19 90.484 19 191s81.484 182 182 182Z" clip-rule="evenodd"/></g><g filter="url(#c)"><path fill="url(#d)" fill-rule="evenodd" d="M200.5 302c61.58 0 111.5-49.92 111.5-111.5S262.08 79 200.5 79 89 128.92 89 190.5 138.92 302 200.5 302Zm0 24c74.835 0 135.5-60.665 135.5-135.5C336 115.665 275.335 55 200.5 55 125.665 55 65 115.665 65 190.5 65 265.335 125.665 326 200.5 326Z" clip-rule="evenodd"/></g><defs><linearGradient id="b" x1="78.771" x2="324.572" y1="51.982" y2="313.9" gradientUnits="userSpaceOnUse"><stop stop-color="#7435CD"/><stop offset="1" stop-color="#33BFF1"/></linearGradient><linearGradient id="d" x1="109.5" x2="292.5" y1="87" y2="282" gradientUnits="userSpaceOnUse"><stop stop-color="#9A35CD"/><stop offset="1" stop-color="#33D1F1"/></linearGradient><filter id="a" width="403.2" height="403.2" x=".4" y=".4" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset dx="1" dy="11"/><feGaussianBlur stdDeviation="9.8"/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix values="0 0 0 0 0.0788033 0 0 0 0 0.401609 0 0 0 0 0.885817 0 0 0 0.17 0"/><feBlend in2="BackgroundImageFix" result="effect1_dropShadow_21_18"/><feBlend in="SourceGraphic" in2="effect1_dropShadow_21_18" result="shape"/></filter><filter id="c" width="310.2" height="310.2" x="46.4" y="46.4" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset dx="1" dy="11"/><feGaussianBlur stdDeviation="9.8"/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix values="0 0 0 0 0.0788033 0 0 0 0 0.670614 0 0 0 0 0.885817 0 0 0 0.17 0"/><feBlend in2="BackgroundImageFix" result="effect1_dropShadow_21_18"/><feBlend in="SourceGraphic" in2="effect1_dropShadow_21_18" result="shape"/></filter></defs></svg>
                            <h2 id="uw-a11y-title">Pinpoint Accessibility Checker</h2>
                        </div>
                        <div class="uw-a11y-header-buttons">
                            <button id="uw-a11y-minimize" title="Minimize">−</button>
                            <button id="uw-a11y-close" title="Close">✕</button>
                        </div>
                    </div>
                    <div id="uw-a11y-content">
                        <div id="uw-a11y-view-results" class="uw-a11y-view" data-results-mode="guided">
                            <div id="uw-a11y-results-header"></div>
                            <div id="uw-a11y-summary"></div>
                            <div id="uw-a11y-guided"></div>
                            <p class="if-issues uw-a11y-advanced-only">
                                <span class="mouse-icon"></span>
                                <small>Select any issue to highlight the element on the page. Press <kbd>Escape</kbd> to return here from a highlighted element.</small>
                            </p>
                            <div id="uw-a11y-results"></div>
                        </div>

                        <div id="uw-a11y-view-history" class="uw-a11y-view" hidden>
                            <div class="uw-a11y-history"></div>
                        </div>

                        <div id="uw-a11y-view-inspector" class="uw-a11y-view" hidden>
                            <div class="uw-a11y-inspector">
                                <div id="uw-a11y-inspector-hub">
                                    <h3>Inspector Tools</h3>
                                    <p>Visual debugging tools to help you understand your page's accessibility structure.</p>

                                    <div class="uw-a11y-inspector-toggle-row">
                                        <div class="uw-a11y-inspector-toggle-main">
                                            <h4>Tab Order</h4>
                                            <p>Numbered indicators show the keyboard tab order of focusable elements.</p>
                                            <span id="uw-a11y-tab-order-count" class="uw-a11y-inspector-status" style="display: none;"></span>
                                        </div>
                                        <label class="uw-a11y-toggle" aria-label="Toggle tab order visualization">
                                            <input id="uw-a11y-tab-order-toggle" type="checkbox">
                                            <span class="uw-a11y-toggle-slider"></span>
                                        </label>
                                    </div>

                                    <div class="uw-a11y-inspector-toggle-row">
                                        <div class="uw-a11y-inspector-toggle-main">
                                            <h4>Focus Indicators</h4>
                                            <p>Preview focus styles on all focusable elements at once.</p>
                                            <span id="uw-a11y-focus-indicators-count" class="uw-a11y-inspector-status" style="display: none;"></span>
                                        </div>
                                        <label class="uw-a11y-toggle" aria-label="Toggle focus indicator preview">
                                            <input id="uw-a11y-focus-indicators-toggle" type="checkbox">
                                            <span class="uw-a11y-toggle-slider"></span>
                                        </label>
                                    </div>

                                    <div class="uw-a11y-inspector-toggle-row">
                                        <div class="uw-a11y-inspector-toggle-main">
                                            <h4>Landmark Structure</h4>
                                            <p>Visualize landmarks and heading hierarchy on the page.</p>
                                            <span id="uw-a11y-landmark-structure-count" class="uw-a11y-inspector-status" style="display: none;"></span>
                                        </div>
                                        <label class="uw-a11y-toggle" aria-label="Toggle landmark structure visualization">
                                            <input id="uw-a11y-landmark-structure-toggle" type="checkbox">
                                            <span class="uw-a11y-toggle-slider"></span>
                                        </label>
                                    </div>

                                    <div class="uw-a11y-inspector-tool-row">
                                        <div class="uw-a11y-inspector-tool-row-main">
                                            <h4>Page outline</h4>
                                            <p class="uw-a11y-inspector-tool-teaser">Heading hierarchy, skipped levels, jump to each heading.</p>
                                            <p id="uw-a11y-inspector-hub-status-outline" class="uw-a11y-inspector-hub-status" aria-live="polite">Not showing outline</p>
                                        </div>
                                        <button type="button" id="uw-a11y-inspector-open-outline" class="uw-a11y-btn uw-a11y-btn-secondary uw-a11y-inspector-tool-open" aria-label="Open page outline tool">
                                            <svg class="feather feather-chevron-right" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                                        </button>
                                    </div>

                                    <div class="uw-a11y-inspector-tool-row">
                                        <div class="uw-a11y-inspector-tool-row-main">
                                            <h4>Links</h4>
                                            <p class="uw-a11y-inspector-tool-teaser">Accessible names, issues, jump to each link.</p>
                                            <p id="uw-a11y-inspector-hub-status-links" class="uw-a11y-inspector-hub-status" aria-live="polite">Not showing links</p>
                                        </div>
                                        <button type="button" id="uw-a11y-inspector-open-links" class="uw-a11y-btn uw-a11y-btn-secondary uw-a11y-inspector-tool-open" aria-label="Open links inspector">
                                            <svg class="feather feather-chevron-right" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                                        </button>
                                    </div>

                                    <div class="uw-a11y-inspector-tool-row">
                                        <div class="uw-a11y-inspector-tool-row-main">
                                            <h4>Color blindness simulation</h4>
                                            <p class="uw-a11y-inspector-tool-teaser">Preview the page with color vision deficiency filters.</p>
                                            <p id="uw-a11y-inspector-hub-status-cvd" class="uw-a11y-inspector-hub-status" aria-live="polite">Off — normal vision</p>
                                        </div>
                                        <button type="button" id="uw-a11y-inspector-open-cvd" class="uw-a11y-btn uw-a11y-btn-secondary uw-a11y-inspector-tool-open" aria-label="Open color blindness simulation">
                                            <svg class="feather feather-chevron-right" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                                        </button>
                                    </div>

                                    <div class="uw-a11y-inspector-tool-row">
                                        <div class="uw-a11y-inspector-tool-row-main">
                                            <h4>Alternative text</h4>
                                            <p class="uw-a11y-inspector-tool-teaser">List alt text for images or show labels on the page.</p>
                                            <p id="uw-a11y-inspector-hub-status-alt" class="uw-a11y-inspector-hub-status" aria-live="polite">Off</p>
                                        </div>
                                        <button type="button" id="uw-a11y-inspector-open-alt" class="uw-a11y-btn uw-a11y-btn-secondary uw-a11y-inspector-tool-open" aria-label="Open alternative text inspector">
                                            <svg class="feather feather-chevron-right" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                                        </button>
                                    </div>

                                    <div class="uw-a11y-inspector-tool-row">
                                        <div class="uw-a11y-inspector-tool-row-main">
                                            <h4>Contrast checker</h4>
                                            <p class="uw-a11y-inspector-tool-teaser">Pick any two elements and compare their colors against WCAG contrast thresholds.</p>
                                            <p id="uw-a11y-inspector-hub-status-contrast" class="uw-a11y-inspector-hub-status" aria-live="polite">No colors picked</p>
                                        </div>
                                        <button type="button" id="uw-a11y-inspector-open-contrast" class="uw-a11y-btn uw-a11y-btn-secondary uw-a11y-inspector-tool-open" aria-label="Open contrast checker">
                                            <svg class="feather feather-chevron-right" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                                        </button>
                                    </div>
                                </div>

                                <div id="uw-a11y-inspector-detail" hidden>
                                    <div class="uw-a11y-inspector-detail-header">
                                        <button type="button" id="uw-a11y-inspector-back" class="uw-a11y-btn uw-a11y-btn-secondary uw-a11y-inspector-back-btn" aria-label="Back to inspector tools">
                                            <svg class="feather feather-chevron-left" fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
                                        </button>
                                        <h3 id="uw-a11y-inspector-detail-heading" class="uw-a11y-inspector-detail-heading"></h3>
                                    </div>

                                    <div id="uw-a11y-inspector-panel-outline" class="uw-a11y-inspector-detail-panel" hidden>
                                        <div class="uw-a11y-inspector-section">
                                            <div class="uw-a11y-inspector-section-header">
                                                <h4>Page Outline</h4>
                                                <span id="uw-a11y-outline-count" class="uw-a11y-inspector-status" style="display: none;"></span>
                                            </div>
                                            <p>View the heading hierarchy to verify correct order and nesting. Skipped levels are flagged. Click any heading to jump to it on the page.</p>
                                            <div id="uw-a11y-outline-content" class="uw-a11y-outline-tree" hidden aria-live="polite"></div>
                                        </div>
                                    </div>

                                    <div id="uw-a11y-inspector-panel-links" class="uw-a11y-inspector-detail-panel" hidden>
                                        <div class="uw-a11y-inspector-section">
                                            <div class="uw-a11y-inspector-section-header">
                                                <h4>Links</h4>
                                                <span id="uw-a11y-links-count" class="uw-a11y-inspector-status" style="display: none;"></span>
                                            </div>
                                            <p>Every link on the page with its accessible name — the text a screen reader announces. Click a link to jump to it. Empty, generic, or ambiguous link text is flagged.</p>
                                            <div id="uw-a11y-links-content" class="uw-a11y-outline-tree" hidden aria-live="polite"></div>
                                        </div>
                                    </div>

                                    <div id="uw-a11y-inspector-panel-cvd" class="uw-a11y-inspector-detail-panel" hidden>
                                        <div class="uw-a11y-inspector-section">
                                            <h4>Color Blindness Simulation</h4>
                                            <p>Preview the page as seen by users with color vision deficiencies. Applies an SVG color filter to the page while this tool is active.</p>
                                            <fieldset class="uw-a11y-cvd-list" id="uw-a11y-cvd-list">
                                                <legend class="sr-only">Color blindness simulation type</legend>
                                                <label class="uw-a11y-cvd-option">
                                                    <input type="radio" name="uw-a11y-cvd" value="none" checked>
                                                    <span class="uw-a11y-cvd-main">
                                                        <span class="uw-a11y-cvd-name">Off</span>
                                                        <span class="uw-a11y-cvd-meta">Normal vision</span>
                                                    </span>
                                                </label>
                                                <label class="uw-a11y-cvd-option">
                                                    <input type="radio" name="uw-a11y-cvd" value="deuteranomaly">
                                                    <span class="uw-a11y-cvd-main">
                                                        <span class="uw-a11y-cvd-name">Green appears weak</span>
                                                        <span class="uw-a11y-cvd-meta">Deuteranomaly · ~5% of men, ~0.4% of women</span>
                                                    </span>
                                                </label>
                                                <label class="uw-a11y-cvd-option">
                                                    <input type="radio" name="uw-a11y-cvd" value="deuteranopia">
                                                    <span class="uw-a11y-cvd-main">
                                                        <span class="uw-a11y-cvd-name">Green greatly reduced</span>
                                                        <span class="uw-a11y-cvd-meta">Deuteranopia · ~1% of men, ~0.01% of women</span>
                                                    </span>
                                                </label>
                                                <label class="uw-a11y-cvd-option">
                                                    <input type="radio" name="uw-a11y-cvd" value="protanomaly">
                                                    <span class="uw-a11y-cvd-main">
                                                        <span class="uw-a11y-cvd-name">Red appears weak</span>
                                                        <span class="uw-a11y-cvd-meta">Protanomaly · ~1% of men, ~0.03% of women</span>
                                                    </span>
                                                </label>
                                                <label class="uw-a11y-cvd-option">
                                                    <input type="radio" name="uw-a11y-cvd" value="protanopia">
                                                    <span class="uw-a11y-cvd-main">
                                                        <span class="uw-a11y-cvd-name">Red greatly reduced</span>
                                                        <span class="uw-a11y-cvd-meta">Protanopia · ~1% of men, ~0.01% of women</span>
                                                    </span>
                                                </label>
                                                <label class="uw-a11y-cvd-option">
                                                    <input type="radio" name="uw-a11y-cvd" value="tritanomaly">
                                                    <span class="uw-a11y-cvd-main">
                                                        <span class="uw-a11y-cvd-name">Blue appears weak</span>
                                                        <span class="uw-a11y-cvd-meta">Tritanomaly · rare; affects men and women equally</span>
                                                    </span>
                                                </label>
                                                <label class="uw-a11y-cvd-option">
                                                    <input type="radio" name="uw-a11y-cvd" value="tritanopia">
                                                    <span class="uw-a11y-cvd-main">
                                                        <span class="uw-a11y-cvd-name">Blue greatly reduced</span>
                                                        <span class="uw-a11y-cvd-meta">Tritanopia · very rare; affects men and women equally</span>
                                                    </span>
                                                </label>
                                                <label class="uw-a11y-cvd-option">
                                                    <input type="radio" name="uw-a11y-cvd" value="achromatomaly">
                                                    <span class="uw-a11y-cvd-main">
                                                        <span class="uw-a11y-cvd-name">Color appears weak</span>
                                                        <span class="uw-a11y-cvd-meta">Achromatomaly · very rare; affects men and women equally</span>
                                                    </span>
                                                </label>
                                                <label class="uw-a11y-cvd-option">
                                                    <input type="radio" name="uw-a11y-cvd" value="achromatopsia">
                                                    <span class="uw-a11y-cvd-main">
                                                        <span class="uw-a11y-cvd-name">Color greatly reduced</span>
                                                        <span class="uw-a11y-cvd-meta">Achromatopsia · ~1 in 33,000</span>
                                                    </span>
                                                </label>
                                            </fieldset>
                                        </div>
                                    </div>

                                    <div id="uw-a11y-inspector-panel-alt" class="uw-a11y-inspector-detail-panel" hidden>
                                        <div class="uw-a11y-inspector-section">
                                            <div class="uw-a11y-inspector-section-header">
                                                <h4>Alternative Text</h4>
                                                <span id="uw-a11y-alt-count" class="uw-a11y-inspector-status" style="display: none;"></span>
                                            </div>
                                            <p>Every image, SVG, and image-role element on the page along with the alt text it exposes to assistive tech.</p>
                                            <div class="uw-a11y-inspector-toggle-row uw-a11y-inspector-toggle-row--inline">
                                                <div class="uw-a11y-inspector-toggle-main">
                                                    <h4>Show overlays on the page</h4>
                                                    <p>Draw each alt-text label on top of its image for a quick visual scan.</p>
                                                </div>
                                                <label class="uw-a11y-toggle" aria-label="Toggle alt-text overlays on the page">
                                                    <input id="uw-a11y-alt-overlay-toggle" type="checkbox">
                                                    <span class="uw-a11y-toggle-slider"></span>
                                                </label>
                                            </div>
                                            <div id="uw-a11y-alt-content" class="uw-a11y-outline-tree" hidden aria-live="polite"></div>
                                        </div>
                                    </div>

                                    <div id="uw-a11y-inspector-panel-contrast" class="uw-a11y-inspector-detail-panel" hidden>
                                        <div class="uw-a11y-inspector-section">
                                            <h4>Contrast Checker</h4>
                                            <p>Click <strong>Pick element</strong> and choose any text on the page — both the foreground and background colors will fill in automatically. For elements over a CSS gradient, the worst-case gradient stop within the text region is sampled. You can also edit the hex values directly or click either color chip to open a picker.</p>
                                            <div class="uw-a11y-contrast-controls-row uw-a11y-contrast-pick-row">
                                                <button type="button" id="uw-a11y-contrast-pick-element" class="uw-a11y-btn uw-a11y-btn-secondary">
                                                    <svg class="feather feather-target" fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                                                    <span>Pick element</span>
                                                </button>
                                            </div>
                                            <div class="uw-a11y-contrast-fields">
                                                <div class="uw-a11y-contrast-field" data-role="foreground">
                                                    <div class="uw-a11y-contrast-field-header">
                                                        <span class="uw-a11y-contrast-field-label">Foreground (text)</span>
                                                    </div>
                                                    <div class="uw-a11y-contrast-input-row">
                                                        <input type="color" id="uw-a11y-contrast-color-fg" class="uw-a11y-contrast-color" value="#000000" aria-label="Foreground color picker">
                                                        <input type="text" id="uw-a11y-contrast-hex-fg" class="uw-a11y-contrast-hex" value="#000000" spellcheck="false" autocomplete="off" aria-label="Foreground hex value">
                                                    </div>
                                                </div>
                                                <div class="uw-a11y-contrast-field" data-role="background">
                                                    <div class="uw-a11y-contrast-field-header">
                                                        <span class="uw-a11y-contrast-field-label">Background</span>
                                                    </div>
                                                    <div class="uw-a11y-contrast-input-row">
                                                        <input type="color" id="uw-a11y-contrast-color-bg" class="uw-a11y-contrast-color" value="#ffffff" aria-label="Background color picker">
                                                        <input type="text" id="uw-a11y-contrast-hex-bg" class="uw-a11y-contrast-hex" value="#ffffff" spellcheck="false" autocomplete="off" aria-label="Background hex value">
                                                    </div>
                                                </div>
                                            </div>

                                            <div class="uw-a11y-contrast-controls-row">
                                                <button type="button" id="uw-a11y-contrast-swap" class="uw-a11y-btn uw-a11y-btn-secondary">
                                                    <svg class="feather feather-shuffle" fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                                                    <span>Swap</span>
                                                </button>
                                                <button type="button" id="uw-a11y-contrast-reset" class="uw-a11y-btn uw-a11y-btn-secondary">
                                                    <svg class="feather feather-rotate-ccw" fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                                                    <span>Reset</span>
                                                </button>
                                            </div>

                                            <div class="uw-a11y-contrast-preview" id="uw-a11y-contrast-preview">
                                                <span class="uw-a11y-contrast-preview-large">Aa</span>
                                                <span class="uw-a11y-contrast-preview-normal">The quick brown fox jumps over the lazy dog.</span>
                                            </div>

                                            <div class="uw-a11y-contrast-result" id="uw-a11y-contrast-result" aria-live="polite">
                                                <div class="uw-a11y-contrast-ratio">
                                                    <span class="uw-a11y-contrast-ratio-value" id="uw-a11y-contrast-ratio-value">—</span>
                                                    <span class="uw-a11y-contrast-ratio-label">contrast ratio</span>
                                                </div>
                                                <ul class="uw-a11y-contrast-checks" id="uw-a11y-contrast-checks">
                                                    <li data-check="aa-normal"><span class="uw-a11y-contrast-check-badge">—</span><span class="uw-a11y-contrast-check-label">AA · normal text</span><span class="uw-a11y-contrast-check-req">4.5:1</span></li>
                                                    <li data-check="aa-large"><span class="uw-a11y-contrast-check-badge">—</span><span class="uw-a11y-contrast-check-label">AA · large text</span><span class="uw-a11y-contrast-check-req">3:1</span></li>
                                                    <li data-check="aaa-normal"><span class="uw-a11y-contrast-check-badge">—</span><span class="uw-a11y-contrast-check-label">AAA · normal text</span><span class="uw-a11y-contrast-check-req">7:1</span></li>
                                                    <li data-check="aaa-large"><span class="uw-a11y-contrast-check-badge">—</span><span class="uw-a11y-contrast-check-label">AAA · large text</span><span class="uw-a11y-contrast-check-req">4.5:1</span></li>
                                                    <li data-check="ui"><span class="uw-a11y-contrast-check-badge">—</span><span class="uw-a11y-contrast-check-label">AA · UI components &amp; graphics</span><span class="uw-a11y-contrast-check-req">3:1</span></li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div id="uw-a11y-view-about" class="uw-a11y-view" hidden>
                            <div class="uw-a11y-about">
                                <div class="uw-a11y-about-hero">
                                    <div class="uw-a11y-about-hero-bg" aria-hidden="true">
                                        <span class="uw-a11y-about-glow uw-a11y-about-glow-a"></span>
                                        <span class="uw-a11y-about-glow uw-a11y-about-glow-b"></span>
                                        <span class="uw-a11y-about-glow uw-a11y-about-glow-c"></span>
                                    </div>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="uw-a11y-about-logo" viewBox="0 0 404 404" fill="none" aria-hidden="true">
                                        <path fill="url(#uw-a11y-about-gA)" fill-rule="evenodd" d="M201 349c87.261 0 158-70.739 158-158S288.261 33 201 33 43 103.739 43 191s70.739 158 158 158Zm0 24c100.516 0 182-81.484 182-182S301.516 9 201 9 19 90.484 19 191s81.484 182 182 182Z" clip-rule="evenodd"/>
                                        <path fill="url(#uw-a11y-about-gB)" fill-rule="evenodd" d="M200.5 302c61.58 0 111.5-49.92 111.5-111.5S262.08 79 200.5 79 89 128.92 89 190.5 138.92 302 200.5 302Zm0 24c74.835 0 135.5-60.665 135.5-135.5C336 115.665 275.335 55 200.5 55 125.665 55 65 115.665 65 190.5 65 265.335 125.665 326 200.5 326Z" clip-rule="evenodd"/>
                                        <defs>
                                            <linearGradient id="uw-a11y-about-gA" x1="78.771" x2="324.572" y1="51.982" y2="313.9" gradientUnits="userSpaceOnUse"><stop stop-color="#7435CD"/><stop offset="1" stop-color="#33BFF1"/></linearGradient>
                                            <linearGradient id="uw-a11y-about-gB" x1="109.5" x2="292.5" y1="87" y2="282" gradientUnits="userSpaceOnUse"><stop stop-color="#9A35CD"/><stop offset="1" stop-color="#33D1F1"/></linearGradient>
                                        </defs>
                                    </svg>
                                    <div class="uw-a11y-about-wordmark">Pinpoint</div>
                                    <div class="uw-a11y-about-tagline">Accessibility Checker</div>
                                    <p class="uw-a11y-about-blurb">Find accessibility issues and best-practice improvements fast — automated results paired with rule-specific guidance.</p>
                                </div>

                                <div class="uw-a11y-about-stats">
                                    <div class="uw-a11y-about-stat">
                                        <span class="uw-a11y-about-stat-label">Version</span>
                                        <span class="uw-a11y-about-stat-value">${this.escapeHtmlContent(this.version || '')}</span>
                                    </div>
                                    <div class="uw-a11y-about-stat">
                                        <span class="uw-a11y-about-stat-label">Engine</span>
                                        <span class="uw-a11y-about-stat-value">axe-core ${this.escapeHtmlContent('v' + (this.getAxeVersion ? (this.getAxeVersion() || 'unknown') : 'unknown'))}</span>
                                    </div>
                                    <div class="uw-a11y-about-stat">
                                        <span class="uw-a11y-about-stat-label">Standard</span>
                                        <span class="uw-a11y-about-stat-value">WCAG 2.1 / 2.2</span>
                                    </div>
                                </div>

                                <div class="uw-a11y-about-features">
                                    <div class="uw-a11y-about-feature">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.39 0 4.68.94 6.36 2.64"/></svg>
                                        <span>Powered by axe-core, the industry-standard rule engine</span>
                                    </div>
                                    <div class="uw-a11y-about-feature">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
                                        <span>Built-in inspectors for contrast, color blindness, links, alt text, and the page outline</span>
                                    </div>
                                    <div class="uw-a11y-about-feature">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20l9-9-9-9-9 9 9 9z"/><path d="M12 11v6"/></svg>
                                        <span>Guided "Top things to fix" walkthrough for non-developers</span>
                                    </div>
                                    <div class="uw-a11y-about-feature">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
                                        <span>Score history tracked locally, per URL</span>
                                    </div>
                                </div>

                                <div class="uw-a11y-about-actions">
                                    <a class="uw-a11y-about-action" href="https://github.com/Heroic-Pixel/Pinpoint-Accessibility-Checker" target="_blank" rel="noopener noreferrer">
                                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.16c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.27-5.24-5.67 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.18-1.48 3.14-1.17 3.14-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12c0-6.35-5.15-11.5-11.5-11.5z"/></svg>
                                        <span>GitHub</span>
                                    </a>
                                    <a class="uw-a11y-about-action" href="https://github.com/Heroic-Pixel/Pinpoint-Accessibility-Checker/issues" target="_blank" rel="noopener noreferrer">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                        <span>Report an issue</span>
                                    </a>
                                    <a class="uw-a11y-about-action" href="https://github.com/Heroic-Pixel/Pinpoint-Accessibility-Checker/releases" target="_blank" rel="noopener noreferrer">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
                                        <span>Changelog</span>
                                    </a>
                                </div>

                                <div class="uw-a11y-about-credit">
                                    Made with care by <a href="https://heroicpixel.com" target="_blank" rel="noopener noreferrer">Heroic Pixel</a>
                                </div>
                            </div>
                        </div>

                        <div id="uw-a11y-view-settings" class="uw-a11y-view" hidden>
                            <div class="uw-a11y-settings">
                                <h3>Settings</h3>
                                <p>Lightweight options will appear here. For now, results filters and checked items persist for this session.</p>
                            </div>
                        </div>

                        <div id="uw-a11y-view-help" class="uw-a11y-view" hidden>
                            <div class="uw-a11y-help"></div>
                        </div>
                    </div>
                </div>
            </div>
            `;
            
            // Add event listeners
            this.shadowRoot.getElementById('uw-a11y-close').onclick = () => this.remove();
            // Hide deprecated minimize control; panel is now draggable
            const minBtn = this.shadowRoot.getElementById('uw-a11y-minimize');
            if (minBtn) minBtn.style.display = 'none';

            // Delegated listeners for elements with data-uw-action.
            // Replaces inline onclick / onkeydown / onchange handlers, which
            // are blocked by strict CSPs that don't allow 'unsafe-inline'
            // for script-src. Each action reads its own data-uw-* attributes.
            if (!this._inlineActionDelegated) {
                const dispatch = (el) => {
                    const action = el.getAttribute('data-uw-action');
                    if (!action || typeof this[action] !== 'function') return false;
                    const arg  = el.getAttribute('data-uw-arg');
                    const rule = el.getAttribute('data-uw-rule');
                    const dir  = el.getAttribute('data-uw-dir');
                    try {
                        switch (action) {
                            case 'navigateInstance':
                                this[action](rule, parseInt(dir, 10));
                                break;
                            case 'highlightCurrentInstance':
                            case 'toggleDetails':
                            case 'toggleInstanceVerification':
                                this[action](rule);
                                break;
                            case 'dismissIssue':
                                this[action](rule, el);
                                break;
                            default:
                                if (arg !== null && arg !== undefined) this[action](arg);
                                else this[action]();
                        }
                    } catch (err) {
                        console.warn('[Pinpoint] inline action ' + action + ' failed:', err && err.message);
                    }
                    return true;
                };

                this.shadowRoot.addEventListener('click', (e) => {
                    const el = e.target && e.target.closest && e.target.closest('[data-uw-action]');
                    if (!el) return;
                    // Inputs/checkboxes dispatch on 'change' instead.
                    if (el.tagName === 'INPUT' && el.type === 'checkbox') return;
                    e.preventDefault();
                    e.stopPropagation();
                    dispatch(el);
                });

                this.shadowRoot.addEventListener('keydown', (e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    const el = e.target && e.target.closest && e.target.closest('[data-uw-action]');
                    if (!el) return;
                    // Native buttons already fire click on Enter/Space — let them.
                    if (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'A') return;
                    e.preventDefault();
                    e.stopPropagation();
                    dispatch(el);
                });

                this.shadowRoot.addEventListener('change', (e) => {
                    const el = e.target && e.target.closest && e.target.closest('[data-uw-action]');
                    if (!el) return;
                    if (el.tagName !== 'INPUT' || el.type !== 'checkbox') return;
                    e.stopPropagation();
                    dispatch(el);
                });

                this._inlineActionDelegated = true;
            }
            // Enable drag on header
            this.initDrag();
            this.initNavigation();
            this.renderSettings();
            this.renderHelp();
            this.renderHistoryView();
            this.applyDockPosition(this.getDockPosition());

            // Load GSAP and animate panel
            this.loadGSAP().then(() => {
                this.setupInitialHeight();
                this.animatePanel();
                // Small delay to ensure panel animation starts before nav animation
                setTimeout(() => {
                    this.animateNavigation();
                }, 100);
                this.setupResizeHandler();
            });

            return this.shadowRoot.getElementById('uw-a11y-panel');
        },
        
        // Get CSS styles as string for Shadow DOM
        getStyles: function() {
            return `<style>
                :host {
                    all: initial;
                    font-family: "Red Hat Display", "Red Hat Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                
                /* ===== Scrollbar CSS ===== */
                /* Firefox */
                * {
                    scrollbar-width: auto;
                    scrollbar-color:rgb(132, 132, 132) rgba(255,255,255,0.0) ;
                }

                /* Chrome, Edge, and Safari */
                *::-webkit-scrollbar {
                    width: 5px;
                }

                *::-webkit-scrollbar-track {
                    background: transparent;
                }

                *::-webkit-scrollbar-thumb {
                    background-color: rgba(0,0,0,0.18);
                    border-radius: 50rem;
                }

                #uw-a11y-wrapper {
                    display: grid;
                    grid-template-columns: 60px 1fr;
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    width: 500px;

                    z-index: 999999;
                    gap: .4rem;
                    background: rgba(0,0,0,0.7);
                    backdrop-filter: blur(20px);
                    padding: 4px;
                    border-radius: 16px;
                    transition: height 0.4s;
                }

                /* Docked-right mode: pin to the right edge full-height instead of floating. */
                #uw-a11y-wrapper.uw-a11y-docked-right {
                    top: 0;
                    right: 0;
                    bottom: 0;
                    width: 510px;
                    height: 100vh;
                    border-radius: 0;
                    padding: 8px;
                }
                #uw-a11y-wrapper.uw-a11y-docked-right #uw-a11y-panel {
                    height: 100%;
                    max-height: none;
                }
                #uw-a11y-wrapper.uw-a11y-docked-right #uw-a11y-content {
                    max-height: calc(100vh - 80px);
                }

                #uw-a11y-nav {
                    justify-content: center;
                    color: #fff;

                }

                #uw-a11y-nav ul {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                    display: flex;
                    gap: 1rem;
                    display: flex;
                    flex-direction: column;
                }

                #uw-a11y-nav ul li {
                    position: relative;
                    /* Prevent FOUC: start hidden; GSAP/CSS will reveal */
                    opacity: 0;
                }

                #uw-a11y-nav ul li a {
                    display: block;
                    color: #fff;
                    text-decoration: none;
                    padding: 0.5rem .5rem;
                    border-radius: 12px;
                    transition: background 0.3s ease;
                    font-size: 0.7rem;
                    text-align: center
                }

                #uw-a11y-nav ul li a:hover {
                    background: rgba(255, 255, 255, 0.1);
                }

                #uw-a11y-nav ul li a.active {
                    background: rgba(255,255,255,0.18);
                }

                #uw-a11y-nav ul li a svg {
                    width: 20px;
                    height: 20px;
                    margin: 0 auto;
                    margin-bottom: 4px;
                    display: block;
                
                }

                .uw-a11y-nav-icon {
                    width: 22px;
                    height: 22px;
                    display: block;
                    margin: 0 auto 4px auto;
                }

                .uw-a11y-nav-label {
                    display: block;
                    line-height: 1.1;
                }

                /* View switching */
                .uw-a11y-view[hidden] { display: none; }

                /* Settings styles */
                .uw-a11y-settings { padding-bottom: 0.5rem; }
                .uw-a11y-form-row { margin: .75rem 0; }
                .uw-a11y-input { width: 80%; padding: 8px 14px; border-radius: 6px; border: 1px solid #cbd3da; font-size: 14px; border-radius: 50rem; }
                .uw-a11y-helptext { font-size: 12px; color: #555; margin-top: 4px; }
                .uw-a11y-actions { display: flex; gap: .5rem; margin-top: .75rem; }
                .uw-a11y-btn { appearance: none; border: 1px solid #b6bcc2; background: #fff; color: #111; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; }
                .uw-a11y-btn.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
                .uw-a11y-btn:disabled { opacity: .6; cursor: not-allowed; }
                .uw-a11y-reset-icon { width: 16px; height: 16px; vertical-align: text-bottom; margin-right: 6px; }
                .uw-a11y-msg { font-size: 12px; margin-top: 6px; }
                .uw-a11y-msg.ok { color: #155724; }
                .uw-a11y-msg.err { color: #721c24; }

                /* ── Toggle switch (used for sound preference) ── */
                .uw-a11y-pref-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 14px;
                    background: rgba(255,255,255,0.75);
                    border: 1px solid rgba(0,0,0,0.07);
                    border-radius: 12px;
                    margin: .75rem 0;
                    grid-gap: 1rem;
                }
                .uw-a11y-pref-label {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .uw-a11y-pref-label strong { font-size: 13px; color: #111; }
                .uw-a11y-pref-label span { font-size: 11px; color: #666; }
                .uw-a11y-toggle {
                    position: relative;
                    display: inline-block;
                    width: 44px;
                    height: 24px;
                    flex-shrink: 0;
                }
                .uw-a11y-toggle input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                    position: absolute;
                }
                .uw-a11y-toggle-slider {
                    position: absolute;
                    inset: 0;
                    background: #ccc;
                    border-radius: 50rem;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .uw-a11y-toggle-slider::before {
                    content: '';
                    position: absolute;
                    width: 18px;
                    height: 18px;
                    left: 3px;
                    top: 3px;
                    background: white;
                    border-radius: 50%;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
                    transition: transform 0.2s;
                }
                .uw-a11y-toggle input:checked + .uw-a11y-toggle-slider {
                    background: #28a745;
                }
                .uw-a11y-toggle input:checked + .uw-a11y-toggle-slider::before {
                    transform: translateX(20px);
                }
                .uw-a11y-toggle input:focus-visible + .uw-a11y-toggle-slider {
                    outline: 2px solid #007cba;
                    outline-offset: 2px;
                }
                @media (prefers-reduced-motion: reduce) {
                    .uw-a11y-toggle-slider,
                    .uw-a11y-toggle-slider::before { transition: none; }
                }

                /* ── Help view ── */
                .uw-a11y-help h3 { margin: 0 0 1rem; font-size: 17px; font-weight: 700; letter-spacing: -0.02em; }
                .uw-a11y-help-search-wrap {
                    position: relative;
                    margin-bottom: 14px;
                }
                .uw-a11y-help-search-wrap svg {
                    position: absolute;
                    left: 11px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #888;
                    pointer-events: none;
                }
                .uw-a11y-help-search {
                    width: 100%;
                    box-sizing: border-box;
                    background: white;
                    border: 1px solid rgba(0,0,0,0.13);
                    padding: 9px 13px 9px 34px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-family: inherit;
                    color: #111;
                    transition: border-color 0.15s, box-shadow 0.15s;
                    appearance: none;
                }
                .uw-a11y-help-search:focus {
                    outline: none;
                    border-color: #007cba;
                    box-shadow: 0 0 0 3px rgba(0,124,186,0.14);
                }
                .uw-a11y-help-level-note {
                    font-size: 11px;
                    color: #595959;
                    margin: 0.6rem 0 0;
                    padding: 8px 12px;
                    background: rgba(0,124,186,0.06);
                    border-left: 3px solid rgba(0,124,186,0.55);
                    border-radius: 4px;
                }
                .uw-a11y-help-level-note strong { color: #1a1a1a; }
                .uw-a11y-help-category {
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                    color: #595959;
                    margin: 1.1rem 0 0.4rem;
                    padding-bottom: 6px;
                    border-bottom: 1px solid rgba(0,0,0,0.08);
                }
                .uw-a11y-help-topic {
                    background: rgba(255,255,255,0.78);
                    border: 1px solid rgba(0,0,0,0.07);
                    border-radius: 10px;
                    margin: 0.4rem 0;
                    overflow: hidden;
                    transition: border-color 0.15s;
                }
                .uw-a11y-help-topic:hover { border-color: rgba(0,0,0,0.15); }
                .uw-a11y-help-topic-head {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 14px;
                    cursor: pointer;
                    user-select: none;
                    font-size: 13px;
                    font-weight: 600;
                    color: #222;
                    background: none;
                    border: none;
                    width: 100%;
                    text-align: left;
                    font-family: inherit;
                }
                .uw-a11y-help-topic-head:focus-visible {
                    outline: 2px solid #007cba;
                    outline-offset: -2px;
                    border-radius: 10px;
                }
                .uw-a11y-help-topic-head::before {
                    content: '';
                    display: inline-block;
                    width: 6px; height: 6px;
                    border-right: 2px solid #888;
                    border-bottom: 2px solid #888;
                    transform: rotate(-45deg);
                    flex-shrink: 0;
                    transition: transform 0.15s;
                    margin-left: 2px;
                }
                .uw-a11y-help-topic.open .uw-a11y-help-topic-head::before {
                    transform: rotate(45deg);
                }
                .uw-a11y-help-topic-head .uw-a11y-help-tag {
                    margin-left: auto;
                    font-size: 10px;
                    font-weight: 600;
                    padding: 2px 7px;
                    border-radius: 4px;
                    background: #eee;
                    color: #666;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    flex-shrink: 0;
                }
                .uw-a11y-help-topic-body {
                    display: none;
                    padding: 0 14px 12px 28px;
                    font-size: 13px;
                    line-height: 1.55;
                    color: #333;
                }
                .uw-a11y-help-topic.open .uw-a11y-help-topic-body { display: block; }
                .uw-a11y-help-topic-body p { margin: 0 0 8px; }
                .uw-a11y-help-topic-body ul { margin: 4px 0 8px; padding-left: 18px; }
                .uw-a11y-help-topic-body li { margin: 3px 0; }
                .uw-a11y-help-topic-body code {
                    background: rgba(0,0,0,0.06);
                    padding: 1px 5px;
                    border-radius: 3px;
                    font-size: 12px;
                }
                .uw-a11y-help-topic-body strong { font-weight: 650; }
                .uw-a11y-help-empty {
                    text-align: center;
                    padding: 2rem 1rem;
                    color: #888;
                    font-size: 13px;
                }
                mark.uw-a11y-help-hl {
                    background: #fff3cd;
                    color: inherit;
                    border-radius: 2px;
                    padding: 0 1px;
                }

                /* ── Settings card layout ── */
                .uw-a11y-settings h3 { margin: 0 0 1rem; font-size: 17px; font-weight: 700; letter-spacing: -0.02em; }
                .uw-a11y-section-divider {
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                    color: #595959;
                    margin: 2.25rem 0 0.5rem;
                    padding-bottom: 7px;
                    border-bottom: 1px solid rgba(0,0,0,0.08);
                }
                .uw-a11y-setting-card {
                    background: rgba(255,255,255,0.78);
                    border: 1px solid rgba(0,0,0,0.07);
                    border-radius: 12px;
                    padding: 14px 16px;
                    margin: 0.55rem 0;
                }
                .uw-a11y-setting-label {
                    display: block;
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    color: #666;
                    margin-bottom: 8px;
                }
                .uw-a11y-setting-card .uw-a11y-input {
                    width: 100%;
                    box-sizing: border-box;
                    background: white;
                    border: 1px solid rgba(0,0,0,0.13);
                    padding: 9px 13px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-family: inherit;
                    color: #111;
                    transition: border-color 0.15s, box-shadow 0.15s;
                    appearance: none;
                }
                .uw-a11y-setting-card .uw-a11y-input:focus {
                    outline: none;
                    border-color: #007cba;
                    box-shadow: 0 0 0 3px rgba(0,124,186,0.14);
                }
                .uw-a11y-setting-card select.uw-a11y-input {
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 10'%3E%3Cpath fill='%23666' d='M8 10 0 0h16z'/%3E%3C/svg%3E");
                    background-repeat: no-repeat;
                    background-position: right 13px center;
                    background-size: 10px 6px;
                    padding-right: 34px;
                    cursor: pointer;
                }
                .uw-a11y-settings-2col {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                }
                .uw-a11y-setting-card .uw-a11y-helptext { margin-top: 8px; }
                .uw-a11y-actions-bar {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    position: sticky;
                    bottom: -20px;
                    z-index: 10;
                    margin: 0 -20px -20px -20px;
                    padding: 12px 20px;
                    background: rgba(240,246,255,0.97);
                    border-top: 1px solid rgba(79,70,229,0.22);
                    box-shadow: 0 -2px 8px rgba(79,70,229,0.08);
                    border-radius: 0 0 14px 14px;
                    animation: uw-a11y-slideup 0.18s ease;
                }
                @keyframes uw-a11y-slideup {
                    from { opacity: 0; transform: translateY(6px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                .uw-a11y-actions-bar[hidden] { display: none; }
                .uw-a11y-actions-bar .uw-a11y-btn {
                    white-space: nowrap;
                    padding: 7px 14px;
                    font-size: 13px;
                    border-radius: 8px;
                }
                .uw-a11y-actions-bar .uw-a11y-btn.primary {
                    background: #4f46e5;
                    border-color: #4f46e5;
                    color: #fff;
                }
                .uw-a11y-actions-bar .uw-a11y-msg {
                    margin: 0;
                    flex: 1;
                    text-align: right;
                    font-size: 12px;
                }
                @keyframes uw-a11y-fadein {
                    from { opacity: 0; transform: translateY(-4px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .uw-a11y-actions-bar { animation: none; }
                }

                #uw-a11y-panel {

                    background: rgba(252, 253, 255, 0.97);
                    border: 1px solid rgba(255,255,255,0.92);
                    border-radius: 14px;
                    backdrop-filter: blur(28px) saturate(180%);
                    box-shadow: 0 24px 64px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.07);
                    z-index: 999999;
                    font-family: "Red Hat Display", "Red Hat Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    font-size: 14px;
                    overflow: hidden;
                    transition: all 0.3s ease;
                    outline: none;
                }
                
                #uw-a11y-panel:focus {
                    outline: 3px solid #007cba;
                    outline-offset: 2px;
                }
                
                /* Screen reader only text */
                .sr-only {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    padding: 0;
                    margin: -1px;
                    overflow: hidden;
                    clip: rect(0, 0, 0, 0);
                    white-space: nowrap;
                    border: 0;
                }
                
                /* Animated click icon */
                .uw-a11y-click-icon {
                    display: inline-block;
                    margin-right: 8px;
                    color: #007cba;
                    animation: uw-pulse 2s ease-in-out infinite;
                    vertical-align: middle;
                }
                
                @keyframes uw-pulse {
                    0% {
                        transform: scale(1);
                        opacity: 1;
                    }
                    50% {
                        transform: scale(1.1);
                        opacity: 0.8;
                    }
                    100% {
                        transform: scale(1);
                        opacity: 1;
                    }
                }

                #uw-a11y-panel .accentcolors {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: -1;
                }

                #uw-a11y-panel .accentcolors .color1 {
                    content: "";
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 30%;
                    height: 60px;
                    filter: blur(60px);
                    background: rgba(121, 20, 222, 0.6);
                    z-index: -1;
                }

                #uw-a11y-panel .accentcolors .color2 {
                    content: "";
                    position: absolute;
                    top: 0;
                    right: 0;
                    width: 30%;
                    height: 50px;
                    filter: blur(60px);
                    background: rgba(52, 126, 223, 0.6);
                    z-index: -1;
                }

                #uw-a11y-panel .accentcolors .color3 {
                    content: "";
                    position: absolute;
                    top: 0;
                    left: 30%;
                    width: 40%;
                    height: 20px;
                    filter: blur(60px);
                    background: rgba(23, 72, 248, 0.6);
                    z-index: -1;
                }

                
                #uw-a11y-panel.minimized {
                    bottom: -1px;
                    top: auto;
                    right: 20px;
                    width: 400px;
                    max-height: 180px;
                    border-radius: 8px 8px 0 0;
                }

                .violationtype {
                    margin-bottom: 0.25rem;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 3px 0;
                }
                #uw-a11y-panel .info-with-tooltip {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    position: relative;
                }
                #uw-a11y-panel .info-btn {
                    background: white;
                    border: 1px solid rgba(0,0,0,0.15);
                    color: #555;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 11px;
                    line-height: 1;
                    cursor: pointer;
                    padding: 0;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                    transition: background 0.15s;
                }
                #uw-a11y-panel .info-btn:focus {
                    outline: 2px solid #007cba;
                    outline-offset: 2px;
                }
                #uw-a11y-panel .tooltip {
                    position: absolute;
                    left: 0;
                    top: 140%;
                    background: #212529;
                    color: #fff;
                    padding: 6px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                    max-width: 260px;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.15s ease;
                    z-index: 10;
                }
                #uw-a11y-panel .info-btn:hover + .tooltip,
                #uw-a11y-panel .info-btn:focus + .tooltip {
                    opacity: 1;
                    visibility: visible;
                }

                
                
                #uw-a11y-panel.minimized #uw-a11y-content {
                    max-height: 120px;
                    padding: 8px 16px;
                    display: none;
                }
                
                #uw-a11y-panel.minimized #uw-a11y-results {
                    display: none;
                }
                
                #uw-a11y-panel.minimized .uw-a11y-score-container {
                    margin: 0.5rem 0;
                    padding: 0.5rem;
                }
                
                #uw-a11y-panel.minimized .uw-a11y-score-dial {
                    width: 60px;
                    height: 60px;
                }
                
                #uw-a11y-panel.minimized .uw-a11y-score-circle {
                    width: 60px;
                    height: 60px;
                }
                
                #uw-a11y-panel.minimized .uw-a11y-score-inner {
                    width: 45px;
                    height: 45px;
                }
                
                #uw-a11y-panel.minimized .uw-a11y-score-number {
                    font-size: 16px;
                }
                
                #uw-a11y-panel.minimized .uw-a11y-score-label {
                    font-size: 8px;
                }
                
                #uw-a11y-panel.minimized .uw-a11y-score-info {
                    width: 14px;
                    height: 14px;
                    font-size: 9px;
                    top: -3px;
                    right: -3px;
                }
                
                #uw-a11y-panel.minimized h3 {
                    font-size: 14px;
                    margin-bottom: 0.5rem;
                }
                
                #uw-a11y-panel.minimized #uw-a11y-minimize {
                    transform: rotate(180deg);
                }
                #uw-a11y-panel #uw-a11y-header {
                    color: #000;
                    padding: 14px 18px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: grab; /* drag handle */
                    user-select: none;
                }
                
                #uw-a11y-panel #uw-a11y-header:active { cursor: grabbing; }
                
                #uw-a11y-panel .uw-a11y-header-buttons {
                    display: flex;
                    gap: 8px;
                }
                #uw-a11y-panel .uw-a11y-title-container {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                #uw-a11y-panel .uw-a11y-logo {
                    width: 24px;
                    height: 24px;
                    flex-shrink: 0;
                }
                
                #uw-a11y-panel.minimized .uw-a11y-logo {
                    width: 18px;
                    height: 18px;
                }

                /* ── About view ────────────────────────────────────────── */
                #uw-a11y-panel .uw-a11y-about {
                    padding: 0 0 24px;
                }
                #uw-a11y-panel .uw-a11y-about-hero {
                    position: relative;
                    text-align: center;
                    padding: 36px 24px 28px;
                    border-radius: 16px;
                    background: linear-gradient(160deg, #f5f3ff 0%, #eff6ff 50%, #ecfeff 100%);
                    border: 1px solid rgba(99,102,241,0.15);
                    overflow: hidden;
                    margin-bottom: 18px;
                }
                #uw-a11y-panel .uw-a11y-about-hero-bg {
                    position: absolute;
                    inset: 0;
                    pointer-events: none;
                    filter: blur(48px);
                    opacity: 0.55;
                }
                #uw-a11y-panel .uw-a11y-about-glow {
                    position: absolute;
                    width: 220px;
                    height: 220px;
                    border-radius: 50%;
                }
                #uw-a11y-panel .uw-a11y-about-glow-a {
                    top: -60px; left: -40px;
                    background: radial-gradient(circle, #a78bfa, transparent 65%);
                }
                #uw-a11y-panel .uw-a11y-about-glow-b {
                    top: -40px; right: -60px;
                    background: radial-gradient(circle, #60a5fa, transparent 65%);
                }
                #uw-a11y-panel .uw-a11y-about-glow-c {
                    bottom: -80px; left: 30%;
                    background: radial-gradient(circle, #5eead4, transparent 65%);
                }
                #uw-a11y-panel .uw-a11y-about-logo {
                    position: relative;
                    width: 88px;
                    height: 88px;
                    filter: drop-shadow(0 8px 18px rgba(116,53,205,0.25));
                    margin-bottom: 14px;
                    animation: uw-a11y-about-float 6s ease-in-out infinite;
                }
                @keyframes uw-a11y-about-float {
                    0%, 100% { transform: translateY(0); }
                    50%      { transform: translateY(-4px); }
                }
                #uw-a11y-panel .uw-a11y-about-wordmark {
                    position: relative;
                    font-size: 28px;
                    font-weight: 800;
                    letter-spacing: -0.02em;
                    background: linear-gradient(120deg, #7435CD 0%, #4f46e5 50%, #0891b2 100%);
                    -webkit-background-clip: text;
                    background-clip: text;
                    color: transparent;
                    line-height: 1.1;
                }
                #uw-a11y-panel .uw-a11y-about-tagline {
                    position: relative;
                    font-size: 13px;
                    font-weight: 600;
                    color: #6b7280;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                    margin-top: 4px;
                }
                #uw-a11y-panel .uw-a11y-about-blurb {
                    position: relative;
                    margin: 14px auto 0;
                    max-width: 380px;
                    font-size: 13.5px;
                    line-height: 1.55;
                    color: #374151;
                }

                #uw-a11y-panel .uw-a11y-about-stats {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 8px;
                    margin-bottom: 18px;
                }
                #uw-a11y-panel .uw-a11y-about-stat {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    padding: 10px 12px;
                    background: #fff;
                    border: 1px solid #e5e7eb;
                    border-radius: 10px;
                    box-shadow: 0 1px 2px rgba(15,23,42,0.04);
                }
                #uw-a11y-panel .uw-a11y-about-stat-label {
                    font-size: 10.5px;
                    font-weight: 600;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                    color: #6b7280;
                }
                #uw-a11y-panel .uw-a11y-about-stat-value {
                    font-size: 13px;
                    font-weight: 700;
                    color: #111827;
                    word-break: break-word;
                }

                #uw-a11y-panel .uw-a11y-about-features {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    margin-bottom: 18px;
                }
                #uw-a11y-panel .uw-a11y-about-feature {
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                    padding: 10px 12px;
                    background: #ffffff;
                    border: 1px solid #e5e7eb;
                    border-radius: 10px;
                    font-size: 13px;
                    line-height: 1.45;
                    color: #1f2937;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease;
                }
                #uw-a11y-panel .uw-a11y-about-feature:hover {
                    border-color: rgba(99,102,241,0.45);
                    box-shadow: 0 4px 12px rgba(99,102,241,0.08);
                }
                #uw-a11y-panel .uw-a11y-about-feature svg {
                    width: 18px;
                    height: 18px;
                    flex-shrink: 0;
                    color: #6366f1;
                    margin-top: 1px;
                }

                #uw-a11y-panel .uw-a11y-about-actions {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 8px;
                    margin-bottom: 16px;
                }
                #uw-a11y-panel .uw-a11y-about-action {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    padding: 14px 8px;
                    background: #ffffff;
                    border: 1px solid #e5e7eb;
                    border-radius: 10px;
                    text-decoration: none;
                    color: #111827;
                    font-size: 12px;
                    font-weight: 600;
                    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
                }
                #uw-a11y-panel .uw-a11y-about-action:hover,
                #uw-a11y-panel .uw-a11y-about-action:focus-visible {
                    transform: translateY(-1px);
                    border-color: rgba(79,70,229,0.55);
                    box-shadow: 0 6px 14px rgba(79,70,229,0.12);
                    background: #fafaff;
                    outline: none;
                }
                #uw-a11y-panel .uw-a11y-about-action svg {
                    width: 20px;
                    height: 20px;
                    color: #4f46e5;
                }

                #uw-a11y-panel .uw-a11y-about-credit {
                    text-align: center;
                    font-size: 12px;
                    color: #6b7280;
                    padding-top: 6px;
                }
                #uw-a11y-panel .uw-a11y-about-credit a {
                    color: #4f46e5;
                    font-weight: 600;
                    text-decoration: none;
                }
                #uw-a11y-panel .uw-a11y-about-credit a:hover,
                #uw-a11y-panel .uw-a11y-about-credit a:focus-visible {
                    text-decoration: underline;
                }
                @media (prefers-reduced-motion: reduce) {
                    #uw-a11y-panel .uw-a11y-about-logo {
                        animation: none;
                    }
                }
                
                #uw-a11y-panel #uw-a11y-header h2 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: bold;
                }
                #uw-a11y-panel #uw-a11y-close, #uw-a11y-panel #uw-a11y-minimize {
                    background: rgba(0,0,0,0.06);
                    border: none;
                    color: #333;
                    font-size: 16px;
                    cursor: pointer;
                    padding: 0;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                }
                
                #uw-a11y-panel #uw-a11y-close:hover, #uw-a11y-panel #uw-a11y-minimize:hover {
                    background: rgba(0,0,0,0.12);
                }
                
                #uw-a11y-panel #uw-a11y-close:focus, #uw-a11y-panel #uw-a11y-minimize:focus {
                    outline: 2px solid #007cba;
                    outline-offset: 2px;
                    background: rgba(255,255,255,0.3);
                }
                
                #uw-a11y-panel #uw-a11y-minimize { display: none; }
                #uw-a11y-panel #uw-a11y-content {
                    max-height: calc(100vh - 108px);
                    overflow-y: auto;
                    padding: 20px;
                    transition: height 0.4s ease-in-out;
                    box-sizing: border-box;
                }

                /* Initial animation states to prevent flash - fast transitions for GSAP override */
                #uw-a11y-wrapper {
                    opacity: 0;
                    transform: scale(0.9) translateY(20px);
                }

                /* Important: Only apply the initial offset when using the CSS fallback.
                   GSAP handles transforms when available, so the base <li> should not be offset. */
                #uw-a11y-nav ul li.uw-a11y-css-animate {
                    opacity: 0;
                    transform: translateX(-30px) scale(0.9);
                }

                /* CSS-only animations (fallback when GSAP not available) */
                #uw-a11y-wrapper.uw-a11y-css-animate {
                    transition: opacity 0.5s ease-out, transform 0.5s ease-out;
                }

                #uw-a11y-nav ul li.uw-a11y-css-animate {
                    transition: opacity 0.6s ease-out, transform 0.6s ease-out;
                }

                /* Stagger delays for CSS-only animations */
                #uw-a11y-nav ul li.uw-a11y-css-animate:nth-child(1) { transition-delay: 0.3s; }
                #uw-a11y-nav ul li.uw-a11y-css-animate:nth-child(2) { transition-delay: 0.4s; }
                #uw-a11y-nav ul li.uw-a11y-css-animate:nth-child(3) { transition-delay: 0.5s; }
                #uw-a11y-nav ul li.uw-a11y-css-animate:nth-child(4) { transition-delay: 0.6s; }
                #uw-a11y-nav ul li.uw-a11y-css-animate:nth-child(5) { transition-delay: 0.7s; }

                /* Show elements when animations are ready */
                #uw-a11y-wrapper.uw-a11y-animate-in {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }

                #uw-a11y-nav ul li.uw-a11y-animate-in {
                    opacity: 1;
                    transform: translateX(0) scale(1);
                }

                /* Respect reduced motion preference */
                @media (prefers-reduced-motion: reduce) {
                    #uw-a11y-panel #uw-a11y-content {
                        transition: none;
                    }
                    
                    #uw-a11y-nav ul li a {
                        transition: none;
                    }

                    /* Immediately show elements when reduced motion is preferred */
                    #uw-a11y-wrapper,
                    #uw-a11y-nav ul li {
                        opacity: 1 !important;
                        transform: none !important;
                        transition: none !important;
                    }
                }
                #uw-a11y-panel #uw-a11y-summary {
                    background: rgba(255,255,255,0.88);
                    border: 1px solid rgba(0,0,0,0.06);
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.07);
                    border-radius: 14px;
                    padding: 18px;
                    margin-bottom: 16px;

                }
                #uw-a11y-panel .uw-a11y-issue {
                    margin-bottom: 14px;
                    padding: 16px 16px 14px 18px;
                    border: 1px solid #e5e7eb;
                    border-left: 4px solid #d1d5db;
                    background: #ffffff;
                    border-radius: 12px;
                    cursor: pointer;
                    transition: box-shadow 0.2s ease, transform 0.15s ease, border-color 0.2s ease;
                    position: relative;
                    outline: none;
                    box-shadow: 0 1px 2px rgba(15,23,42,0.04);
                }

                /* Type-specific accents — neutralized fills, color reserved
                   for the left border, icon, badge, and learn-more link. */
                #uw-a11y-panel .uw-a11y-issue.error {
                    border-left-color: #dc3545;
                    background: #fffbfb; /* barely-there red — keeps urgency without flooding */
                }
                #uw-a11y-panel .uw-a11y-issue.warning {
                    border-left-color: #f0a500;
                    background: #ffffff;
                }
                #uw-a11y-panel .uw-a11y-issue.info {
                    border-left-color: #17a2b8;
                    background: #ffffff;
                }

                /* Hover — subtle lift; no pastel flood. */
                #uw-a11y-panel .uw-a11y-issue:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 6px 16px rgba(15,23,42,0.08);
                    border-color: #d1d5db;
                }
                #uw-a11y-panel .uw-a11y-issue.error:hover  { border-left-color: #dc3545; box-shadow: 0 6px 16px rgba(220,53,69,0.18); }
                #uw-a11y-panel .uw-a11y-issue.warning:hover { border-left-color: #f0a500; box-shadow: 0 6px 16px rgba(240,165,0,0.18); }
                #uw-a11y-panel .uw-a11y-issue.info:hover    { border-left-color: #17a2b8; box-shadow: 0 6px 16px rgba(23,162,184,0.18); cursor: default; }

                /* Focus — keep colored outlines for keyboard users. */
                #uw-a11y-panel .uw-a11y-issue:focus {
                    outline: 3px solid #007cba;
                    outline-offset: 2px;
                    transform: translateY(-1px);
                    z-index: 1;
                }
                #uw-a11y-panel .uw-a11y-issue.error:focus   { outline-color: #dc3545; }
                #uw-a11y-panel .uw-a11y-issue.warning:focus { outline-color: #f0a500; }
                #uw-a11y-panel .uw-a11y-issue.info:focus    { outline-color: #17a2b8; }

                #uw-a11y-panel .uw-a11y-issue:active {
                    transform: translateY(0px);
                    transition: transform 0.1s ease;
                }

                /* Verified manual-review items — green left bar + faint tint. */
                #uw-a11y-panel .uw-a11y-issue.checked {
                    border-left-color: #28a745;
                    background: #f4faf5;
                }
                #uw-a11y-panel .uw-a11y-issue.checked:hover {
                    box-shadow: 0 6px 16px rgba(40,167,69,0.18);
                }
                #uw-a11y-panel .uw-a11y-issue.checked:focus {
                    outline-color: #28a745;
                }

                /* Severity badge — small pill that carries the type label. */
                #uw-a11y-panel .uw-a11y-issue-badge {
                    display: inline-flex;
                    align-items: center;
                    flex-shrink: 0;
                    margin-left: auto;
                    padding: 2px 9px;
                    border-radius: 999px;
                    font-size: 10.5px;
                    font-weight: 700;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                    line-height: 1.6;
                    border: 1px solid transparent;
                    white-space: nowrap;
                }
                #uw-a11y-panel .uw-a11y-issue-badge.type-error   { background: rgba(220,53,69,0.10);  color: #b91c1c; border-color: rgba(220,53,69,0.30); }
                #uw-a11y-panel .uw-a11y-issue-badge.type-warning { background: rgba(240,165,0,0.12);  color: #92590a; border-color: rgba(240,165,0,0.35); }
                #uw-a11y-panel .uw-a11y-issue-badge.type-info    { background: rgba(23,162,184,0.10); color: #0c6478; border-color: rgba(23,162,184,0.32); }
                #uw-a11y-panel .uw-a11y-issue.checked .uw-a11y-issue-badge.type-warning {
                    background: rgba(40,167,69,0.10);
                    color: #166534;
                    border-color: rgba(40,167,69,0.32);
                }
                #uw-a11y-panel .uw-a11y-issue h4 {
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    font-weight: 700;
                    line-height: 1.4;
                    letter-spacing: -0.01em;
                }
                 
                 #uw-a11y-panel .uw-a11y-issue-header {
                     display: flex;
                     align-items: center;
                     gap: 8px;
                 }
                 
                #uw-a11y-panel .uw-a11y-issue-icon {
                    width: 18px;
                    height: 18px;
                    flex-shrink: 0;
                    align-self: flex-start;
                }
                 
                 #uw-a11y-panel .uw-a11y-error-icon {
                     color: #dc3545;
                     margin-top: 2px;
                 }
                 
                 #uw-a11y-panel .uw-a11y-warning-icon {
                     color: #856404;
                     margin-top: 2px;
                 }
                 
                 #uw-a11y-panel .uw-a11y-issue.checked .uw-a11y-issue-icon.type-warning {
                     color: #155724;
                 }
                 
                 #uw-a11y-panel .uw-a11y-issue-title {
                     flex: 1;
                 }

                /* Unified icon styles for summary + issue items */
                #uw-a11y-panel .issue-type-icon svg {
                    width: 18px;
                    height: 18px;
                    display: inline-block;
                    vertical-align: middle;
                }
                #uw-a11y-panel .issue-type-icon { display: inline-flex; align-items: center; margin: 0 4px 0 6px; }
                #uw-a11y-panel .issue-type-icon.type-error svg,
                #uw-a11y-panel .uw-a11y-issue-icon.type-error { color: #dc3545; }
                #uw-a11y-panel .issue-type-icon.type-warning svg,
                #uw-a11y-panel .uw-a11y-issue-icon.type-warning { color: #e0a800; }
                #uw-a11y-panel .issue-type-icon.type-info svg,
                #uw-a11y-panel .uw-a11y-issue-icon.type-info { color: #17a2b8; }
                #uw-a11y-panel .uw-a11y-issue p {
                    margin: 4px 0;
                    line-height: 1.4;
                }
                #uw-a11y-panel .uw-a11y-issue .issue-meta {
                    font-size: 12px;
                    color: #3c3c3c;
                    margin-top: 8px;
                    padding-top: 8px;
                    border-top: 1px solid rgba(0,0,0,0.1);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                #uw-a11y-panel .uw-a11y-issue .learn-more {
                    color: #c5050c;

                    font-size: 12px;
                }
                #uw-a11y-panel .uw-a11y-issue .learn-more:hover {
                    text-decoration: underline;
                }

                /* Dismiss button */
                #uw-a11y-panel .uw-a11y-dismiss-btn {
                    flex-shrink: 0;
                    background: none;
                    border: 1px solid rgba(0,0,0,0.18);
                    border-radius: 5px;
                    color: #595959;
                    font-size: 11px;
                    font-family: inherit;
                    padding: 2px 8px;
                    cursor: pointer;
                    transition: background 0.15s, color 0.15s;
                    white-space: nowrap;
                }
                #uw-a11y-panel .uw-a11y-dismiss-btn:hover {
                    background: #f3f4f6;
                    color: #374151;
                    border-color: #adb5bd;
                }
                #uw-a11y-panel .uw-a11y-dismiss-btn--confirming {
                    background: #fffbeb;
                    color: #92400e;
                    border-color: #f59e0b;
                    font-weight: 600;
                }
                #uw-a11y-panel .uw-a11y-dismiss-btn--confirming:hover {
                    background: #fef3c7;
                    border-color: #d97706;
                }

                /* Dismissed banner above issue list */
                #uw-a11y-panel .uw-a11y-dismissed-banner {
                    font-size: 12px;
                    color: #545b64;
                    background: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    padding: 7px 12px;
                    margin-bottom: 10px;
                }

                /* Inline link-style button (restore all) */
                #uw-a11y-panel .uw-a11y-link-btn {
                    background: none;
                    border: none;
                    padding: 0;
                    color: #4f46e5;
                    font-size: inherit;
                    font-family: inherit;
                    cursor: pointer;
                    text-decoration: underline;
                }

                #uw-a11y-panel .uw-a11y-issue.error .learn-more {
                    color: #dc3545;
                }

                #uw-a11y-panel .uw-a11y-issue.warning .learn-more {
                    color: #856404;
                }

                #uw-a11y-panel .uw-a11y-issue .how-to-fix {
                    margin-top: 12px;
                    border-radius: 10px;
                    background: #ffffff;
                    padding: 12px 14px;
                    font-size: 13px;
                    line-height: 1.55;
                    color: #1a1a2e;
                    font-weight: 400;
                    border: 1px solid #e5e7eb;
                    border-left: 3px solid rgb(51, 141, 214);
                    box-shadow: 0 1px 2px rgba(15,23,42,0.04);
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                }

                #uw-a11y-panel .uw-a11y-issue .how-to-fix-icon {
                    align-self: flex-start;
                    margin-top: 2px;
                }

                #uw-a11y-panel .uw-a11y-issue .how-to-fix-icon svg {
                    width: 12px;
                    height: 12px;
                }

                #uw-a11y-panel .uw-a11y-issue .how-to-fix svg path {
                    fill: rgb(51, 141, 214);
        }

                
                /* Note: .uw-a11y-highlight is applied to the main document, not shadow DOM */
                #uw-a11y-panel .uw-a11y-count {
                    font-weight: bold;
                    padding: 2px 8px;
                    border-radius: 12px;
                    color: white;
                    font-size: 12px;
                    margin-right: 8px;
                }
                #uw-a11y-panel .count-error { background: #dc3545; }
                #uw-a11y-panel .count-warning { background: #ffc107; color: #212529; }
                #uw-a11y-panel .count-info { background: #17a2b8; }
                #uw-a11y-panel .count-verified { background: #28a745; }
                #uw-a11y-panel .filter-toggle .icon-eye-off { display: none; }
                #uw-a11y-panel .filter-toggle[aria-pressed="false"] .icon-eye { display: none; }
                #uw-a11y-panel .filter-toggle[aria-pressed="false"] .icon-eye-off { display: inline; }
                #uw-a11y-panel .filter-toggle {
                    background: rgba(255,255,255,0.7);
                    border: 1px solid rgba(0,0,0,0.12);
                    border-radius: 8px;
                    padding: 5px 10px;
                    cursor: pointer;
                    color: #333;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    transition: background 0.15s;
                }
                #uw-a11y-panel .filter-toggle:hover {
                    background: rgba(0,0,0,0.05);
                }
                #uw-a11y-panel .filter-toggle:focus {
                    outline: 2px solid #007cba;
                    outline-offset: 2px;
                }
                #uw-a11y-panel .filter-toggle[aria-pressed="false"] {
                    opacity: 0.45;
                }
                #uw-a11y-panel .filter-icon { width: 16px; height: 16px; }
                #uw-a11y-panel .uw-a11y-manual-check {
                    margin: 12px 0;
                    padding: 12px 14px;
                    background: rgba(255,255,255,0.75);
                    border-radius: 10px;
                    border: 1px solid rgba(0,0,0,0.08);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                #uw-a11y-panel .uw-a11y-manual-check .uw-a11y-instance-progress {
                    font-size: 12px;
                    color: #155724;
                    opacity: 0.85;
                    font-variant-numeric: tabular-nums;
                    white-space: nowrap;
                }
                #uw-a11y-panel .uw-a11y-checkbox {
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                    font-size: 13px;
                }
                #uw-a11y-panel .uw-a11y-checkbox input[type="checkbox"] {
                    margin-right: 10px;
                    width: 18px;
                    height: 18px;
                    accent-color: #28a745;
                    cursor: pointer;
                }
                #uw-a11y-panel .uw-a11y-issue.checked {
                    opacity: 0.85;
                    background: #f4faf5 !important;
                    border-left-color: #28a745 !important;
                }
                #uw-a11y-panel .uw-a11y-issue.checked .uw-a11y-manual-check {
                    background: rgba(40,167,69,0.08);
                    border-color: rgba(40,167,69,0.25);
                }
                #uw-a11y-panel .uw-a11y-check-label {
                    color: #155724;
                    font-weight: 500;
                }
                #uw-a11y-panel .uw-a11y-spinner {
                    width: 40px;
                    height: 40px;
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #c5050c;
                    border-radius: 50%;
                    animation: uw-spin 1s linear infinite;
                    margin: 0 auto;
                }
                @keyframes uw-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                #uw-a11y-panel .axe-summary {
                    font-size: 12px;
                    color: #666;
                    border-top: 1px solid #dee2e6;
                    padding-top: 12px;
                    margin-top: 12px;
                }
                #uw-a11y-panel .uw-a11y-score-container {
                    text-align: center;
                    margin: 0.5rem 0 1rem;
                    padding: 1.25rem 1rem;
                    background: rgba(255,255,255,0.75);
                    border-radius: 12px;
                    border: 1px solid rgba(0,0,0,0.05);
                    box-shadow: 0 2px 10px rgba(0,0,0,0.06);
                }
                #uw-a11y-panel .uw-a11y-score-sparkline {
                    margin-top: 10px;
                    color: #4f46e5;
                }
                #uw-a11y-panel .uw-a11y-spark-link {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    text-decoration: none;
                    color: inherit;
                    padding: 4px 8px;
                    border-radius: 6px;
                    transition: background 0.15s ease;
                }
                #uw-a11y-panel .uw-a11y-spark-link:hover,
                #uw-a11y-panel .uw-a11y-spark-link:focus-visible {
                    background: rgba(79,70,229,0.08);
                    outline: none;
                }
                #uw-a11y-panel .uw-a11y-spark-svg {
                    display: block;
                }
                #uw-a11y-panel .uw-a11y-spark-meta {
                    font-size: 11px;
                    color: #555;
                    display: inline-flex;
                    gap: 4px;
                    align-items: baseline;
                }
                #uw-a11y-panel .uw-a11y-spark-delta { font-weight: 600; }
                #uw-a11y-panel .uw-a11y-spark-count { color: #888; }

                /* History view */
                #uw-a11y-panel .uw-a11y-history-wrap { padding: 4px 2px 12px; }
                #uw-a11y-panel .uw-a11y-history-wrap h3 { margin: 0 0 4px; font-size: 16px; }
                #uw-a11y-panel .uw-a11y-history-wrap h4 { margin: 12px 0 6px; font-size: 13px; color: #444; }
                #uw-a11y-panel .uw-a11y-history-bucket {
                    font-size: 11px;
                    color: #666;
                    margin: 0 0 14px;
                }
                #uw-a11y-panel .uw-a11y-history-bucket code {
                    background: rgba(0,0,0,0.05);
                    padding: 1px 5px;
                    border-radius: 4px;
                }
                #uw-a11y-panel .uw-a11y-history-filter-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    margin: 0 0 10px;
                    font-size: 11px;
                    color: #555;
                    flex-wrap: wrap;
                }
                #uw-a11y-panel .uw-a11y-history-filter-label strong { color: #4f46e5; }
                #uw-a11y-panel .uw-a11y-history-empty-filter {
                    background: rgba(79,70,229,0.05);
                    border: 1px dashed rgba(79,70,229,0.3);
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 12px;
                }
                #uw-a11y-panel .uw-a11y-history-empty-filter p {
                    margin: 0;
                    font-size: 12px;
                    color: #4f46e5;
                }
                #uw-a11y-panel .uw-a11y-history-chart,
                #uw-a11y-panel .uw-a11y-history-bars {
                    background: rgba(255,255,255,0.7);
                    border: 1px solid rgba(0,0,0,0.06);
                    border-radius: 8px;
                    padding: 6px 8px;
                    margin-bottom: 12px;
                }
                #uw-a11y-panel .uw-a11y-history-legend {
                    display: flex;
                    gap: 14px;
                    font-size: 11px;
                    color: #555;
                    margin-top: 4px;
                    padding: 0 8px;
                }
                #uw-a11y-panel .uw-a11y-history-legend i {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    border-radius: 2px;
                    margin-right: 5px;
                    vertical-align: middle;
                }
                #uw-a11y-panel .uw-a11y-history-deltas {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 6px;
                    margin: 4px 0 6px;
                }
                #uw-a11y-panel .uw-a11y-history-delta {
                    background: rgba(255,255,255,0.7);
                    border: 1px solid rgba(0,0,0,0.06);
                    border-radius: 8px;
                    padding: 8px 6px;
                    text-align: center;
                }
                #uw-a11y-panel .uw-a11y-history-delta strong {
                    display: block;
                    font-size: 20px;
                    line-height: 1.1;
                    font-variant-numeric: tabular-nums;
                    color: #222;
                }
                #uw-a11y-panel .uw-a11y-history-delta span {
                    display: block;
                    font-size: 10px;
                    color: #666;
                    margin-top: 2px;
                }
                #uw-a11y-panel .uw-a11y-history-delta-badge {
                    display: inline-block;
                    margin-top: 4px;
                    font-size: 10px;
                    font-weight: 600;
                    padding: 1px 6px;
                    border-radius: 999px;
                    line-height: 1.4;
                    background: rgba(0,0,0,0.06);
                    color: #555;
                    font-variant-numeric: tabular-nums;
                }
                #uw-a11y-panel .uw-a11y-history-delta-badge.is-good {
                    background: rgba(25,135,84,0.12);
                    color: #198754;
                }
                #uw-a11y-panel .uw-a11y-history-delta-badge.is-bad {
                    background: rgba(178,34,34,0.12);
                    color: #b22222;
                }
                #uw-a11y-panel .uw-a11y-history-summary-heading {
                    font-size: 13px;
                    margin: 14px 0 6px;
                    color: #444;
                }
                #uw-a11y-panel .uw-a11y-history-summary-sub {
                    font-weight: normal;
                    color: #888;
                    font-size: 11px;
                }
                #uw-a11y-panel .uw-a11y-history-cfg-warn {
                    font-size: 11px;
                    color: #8a6d3b;
                    background: #fcf8e3;
                    border: 1px solid #faebcc;
                    padding: 6px 10px;
                    border-radius: 6px;
                    margin: 0 0 12px;
                }
                /* Subtle "Looks like a WordPress site" hint pill rendered
                   between the score dial and the partial-scan banner. */
                #uw-a11y-panel .uw-a11y-preset-hint {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: rgba(25,135,84,0.07);
                    border: 1px solid rgba(25,135,84,0.25);
                    color: #146c43;
                    font-size: 12px;
                    border-radius: 8px;
                    padding: 8px 12px;
                    margin-bottom: 10px;
                }
                #uw-a11y-panel .uw-a11y-preset-hint-icon {
                    flex-shrink: 0;
                    color: #198754;
                }
                #uw-a11y-panel .uw-a11y-preset-hint-text {
                    flex: 1;
                    line-height: 1.35;
                }
                #uw-a11y-panel .uw-a11y-preset-hint-actions {
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    align-items: stretch;
                }
                #uw-a11y-panel .uw-a11y-preset-hint-apply {
                    background: #198754;
                    color: #fff;
                    border: 1px solid #198754;
                    border-radius: 6px;
                    padding: 4px 10px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.15s ease;
                    text-align: center;
                    white-space: nowrap;
                }
                #uw-a11y-panel .uw-a11y-preset-hint-apply:hover,
                #uw-a11y-panel .uw-a11y-preset-hint-apply:focus-visible {
                    background: #146c43;
                    outline: none;
                }
                #uw-a11y-panel .uw-a11y-preset-hint-alt {
                    background: transparent;
                    color: #146c43;
                    border: 1px solid rgba(25,135,84,0.45);
                    border-radius: 6px;
                    padding: 3px 10px;
                    font-size: 11.5px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.15s ease, border-color 0.15s ease;
                    text-align: center;
                    white-space: nowrap;
                }
                #uw-a11y-panel .uw-a11y-preset-hint-alt:hover,
                #uw-a11y-panel .uw-a11y-preset-hint-alt:focus-visible {
                    background: rgba(25,135,84,0.12);
                    border-color: #146c43;
                    outline: none;
                }
                #uw-a11y-panel .uw-a11y-preset-hint-dismiss {
                    flex-shrink: 0;
                    background: none;
                    border: none;
                    color: #146c43;
                    font-size: 14px;
                    cursor: pointer;
                    padding: 2px 6px;
                    border-radius: 4px;
                    line-height: 1;
                    opacity: 0.7;
                    transition: opacity 0.15s ease, background 0.15s ease;
                }
                #uw-a11y-panel .uw-a11y-preset-hint-dismiss:hover,
                #uw-a11y-panel .uw-a11y-preset-hint-dismiss:focus-visible {
                    opacity: 1;
                    background: rgba(25,135,84,0.12);
                    outline: none;
                }
                #uw-a11y-panel .uw-a11y-history-rules {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 14px;
                    margin-top: 4px;
                }
                #uw-a11y-panel .uw-a11y-history-rules ul {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                    font-size: 11px;
                }
                #uw-a11y-panel .uw-a11y-history-rules li {
                    margin-bottom: 3px;
                }
                #uw-a11y-panel .uw-a11y-history-rules code {
                    background: rgba(0,0,0,0.05);
                    padding: 1px 5px;
                    border-radius: 4px;
                    font-size: 11px;
                }
                #uw-a11y-panel .uw-a11y-history-rule-empty { color: #888; font-style: italic; }
                #uw-a11y-panel .uw-a11y-history-actions {
                    display: flex;
                    gap: 8px;
                    margin-top: 16px;
                    flex-wrap: wrap;
                }
                #uw-a11y-panel .uw-a11y-score-dial {
                    position: relative;
                    width: 120px;
                    height: 120px;
                    margin: 0 auto 1rem auto;
                }
                #uw-a11y-panel .uw-a11y-score-circle {
                    width: 120px;
                    height: 120px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                }
                #uw-a11y-panel .uw-a11y-score-svg {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    transform: rotate(-90deg);
                    pointer-events: none;
                }
                #uw-a11y-panel .uw-a11y-score-track {
                    fill: none;
                    stroke: #e9ecef;
                    stroke-width: 14;
                }
                #uw-a11y-panel .uw-a11y-score-progress {
                    fill: none;
                    stroke-width: 14;
                    stroke-linecap: round;
                    transition: stroke 0.3s ease;
                }
                #uw-a11y-panel .uw-a11y-score-inner {
                    position: relative;
                    z-index: 1;
                    width: 92px;
                    height: 92px;
                    background: white;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-direction: column;
                    font-weight: bold;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                #uw-a11y-panel .uw-a11y-score-number {
                    font-size: 28px;
                    font-weight: 800;
                    color: #111;
                    letter-spacing: -0.03em;
                }
                #uw-a11y-panel .uw-a11y-score-label {
                    font-size: 10px;
                    color: #666;
                    text-transform: uppercase;
                }
                #uw-a11y-panel .uw-a11y-score-info {
                    position: absolute;
                    top: -5px;
                    right: -25px;
                    width: 18px;
                    height: 18px;
                    background: #fff;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 11px;
                    font-weight: bold;
                    cursor: pointer;
                    color: #000;
                    border: 2px solid white;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                    transition: all 0.2s ease;
                }
                #uw-a11y-panel .uw-a11y-score-info:hover,
                #uw-a11y-panel .uw-a11y-score-info:focus {
                    background: #4338ca;
                    transform: scale(1.1);
                    color: #fff;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                }
                #uw-a11y-panel .uw-a11y-score-info:focus-visible {
                    outline: 2px solid #4f46e5;
                    outline-offset: 2px;
                }
                #uw-a11y-panel .uw-a11y-details {
                    margin-top: 1rem;
                    padding: 0.5rem;
                    background: #f1f3f4;
                    border-left: 3px solid #007cba;
                    border-radius: 0 4px 4px 0;
                    font-size: 12px;
                    display: none;
                }
                #uw-a11y-panel .uw-a11y-details.expanded {
                    display: block;
                }
                #uw-a11y-panel .uw-a11y-details-toggle {
                    display: block;
                    background: rgba(0,0,0,0.06);
                    border: 1px solid rgba(0,0,0,0.1);
                    border-radius: 50rem;
                    padding: 6px 14px;
                    color: rgb(44, 44, 60);
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 500;
                    transition: background 0.15s, transform 0.1s;
                    text-decoration: none;
                    backdrop-filter: saturate(250%);
                    margin-top: 0.5rem;
                }

                #uw-a11y-panel .uw-a11y-details-toggle {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }


                #uw-a11y-panel .uw-a11y-details-toggle .technical-details-icon {
                    width: 12px;
                    height: 12px;
                }

                #uw-a11y-panel .uw-a11y-details-item {
                    margin: 0.5rem 0;
                    padding: 0.5rem;
                    background: white;
                    border-radius: 3px;
                }

                #uw-a11y-panel .uw-a11y-details-label {
                    font-weight: bold;
                    color: #495057;
                }
                #uw-a11y-panel .uw-a11y-details-value {
                    font-family: monospace;
                    background: #f8f9fa;
                    padding: 0.25rem;
                    border-radius: 2px;
                    margin-top: 0.25rem;
                    word-break: break-all;
                }
                #uw-a11y-panel .uw-a11y-instance-nav {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-top: -16px;
                    margin-left: -16px;
                    margin-right: -16px;
                    margin-bottom: 14px;
                    padding: 10px 14px;
                    background: rgba(0,0,0,0.055);
                    border-bottom: 1px solid rgba(0,0,0,0.07);
                    border-top-left-radius: 12px;
                    border-top-right-radius: 12px;
                    font-size: 12px;
                }
                #uw-a11y-panel .uw-a11y-instance-count {
                    font-weight: 600;
                    color: #444;
                    letter-spacing: 0.01em;
                }
                #uw-a11y-panel .uw-a11y-nav-buttons {
                    display: flex;
                    gap: 6px;
                }
                #uw-a11y-panel .uw-a11y-nav-buttons button {
                    background: rgba(0,0,0,0.5);
                    color: white;
                    border: none;
                    padding: 5px 13px;
                    border-radius: 50rem;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.15s, transform 0.1s;
                    letter-spacing: 0.02em;
                }
                #uw-a11y-panel .uw-a11y-nav-buttons button:hover:not(:disabled) {
                    background: rgba(0,0,0,0.72);
                    transform: translateY(-1px);
                }
                #uw-a11y-panel .uw-a11y-nav-buttons button:active:not(:disabled) {
                    transform: translateY(0);
                }
                #uw-a11y-panel .uw-a11y-nav-buttons button:disabled {
                    background: rgba(0,0,0,0.15);
                    color: rgba(255,255,255,0.45);
                    cursor: not-allowed;
                }

                #uw-a11y-panel .uw-a11y-nav-buttons button:focus {
                    outline: 2px solid #007cba;
                    outline-offset: 2px;
                }
                
                /* Details toggle button focus */
                #uw-a11y-panel .uw-a11y-details-toggle:focus {
                    outline: 2px solid #007cba;
                    outline-offset: 2px;
                    background: rgba(0,0,0,0.2);
                }
                
                /* Checkbox focus states */
                #uw-a11y-panel .uw-a11y-checkbox input[type="checkbox"]:focus {
                    outline: 2px solid #007cba;
                    outline-offset: 2px;
                }
                
                /* Learn more link focus */
                #uw-a11y-panel .uw-a11y-issue .learn-more:focus {
                    outline: 2px solid #007cba;
                    outline-offset: 2px;
                    text-decoration: underline;
                }
        
        #uw-a11y-panel .how-to-fix code {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 3px;
            padding: 2px 4px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 12px;
            color: #e83e8c;
            font-weight: 600;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            word-break: break-word;
        }
        
        #uw-a11y-panel .how-to-fix code:not(:last-child) {
            margin-right: 2px;
        }

        /* Platform-specific tip appended to a recommendation. Visually
           anchored to the surrounding "How to fix" block but distinct
           enough that users notice it's tailored to their CMS. */
        #uw-a11y-panel .uw-a11y-platform-tip {
            margin-top: 10px;
            padding: 10px 12px;
            background: rgba(79, 70, 229, 0.06);
            border: 1px solid rgba(79, 70, 229, 0.18);
            border-left: 3px solid #4f46e5;
            border-radius: 6px;
            font-size: 12.5px;
            line-height: 1.5;
            color: #1f2937;
        }
        #uw-a11y-panel .uw-a11y-platform-tip strong {
            color: #4f46e5;
        }
        #uw-a11y-panel .uw-a11y-platform-tip code {
            background: rgba(79, 70, 229, 0.1);
            border-color: rgba(79, 70, 229, 0.2);
        }

        #uw-a11y-panel .uw-a11y-inline-action {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: rgba(79,70,229,0.10);
            color: #4f46e5;
            border: 1px solid rgba(79,70,229,0.30);
            border-radius: 999px;
            padding: 2px 9px;
            font-size: 11.5px;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            line-height: 1.4;
            margin: 0 2px;
            vertical-align: baseline;
            transition: background 0.15s ease, border-color 0.15s ease;
        }
        #uw-a11y-panel .uw-a11y-inline-action:hover,
        #uw-a11y-panel .uw-a11y-inline-action:focus-visible {
            background: rgba(79,70,229,0.18);
            border-color: rgba(79,70,229,0.55);
            outline: none;
        }
        #uw-a11y-panel .uw-a11y-inline-action svg {
            flex-shrink: 0;
        }

        /* Close button on the in-panel update notification */
        .uw-a11y-update-close:hover,
        .uw-a11y-update-close:focus-visible {
            opacity: 1 !important;
            background-color: rgba(255, 255, 255, 0.2) !important;
        }

        /* Score explanation modal styles */
        .uw-a11y-score-explanation {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000001;
            padding: 20px;
            box-sizing: border-box;
        }
        
        .uw-a11y-explanation-content {
            background: white;
            border-radius: 8px;
            max-width: 600px;
            width: 100%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }
        
        .uw-a11y-explanation-header {
            padding: 20px 20px 0 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #e9ecef;
            margin-bottom: 20px;
        }
        
        .uw-a11y-explanation-header h3 {
            margin: 0;
            color: #333;
            font-size: 20px;
            font-weight: 600;
        }
        
        .uw-a11y-explanation-close {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            padding: 5px;
            color: #666;
            transition: color 0.2s ease;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .uw-a11y-explanation-close:hover,
        .uw-a11y-explanation-close:focus {
            color: #333;
            outline: 2px solid #4f46e5;
            outline-offset: 2px;
        }

        .uw-a11y-explanation-body {
            padding: 0 20px 20px 20px;
            color: #333;
            line-height: 1.6;
        }

        .uw-a11y-explanation-body h4 {
            color: #4f46e5;
            margin: 20px 0 10px 0;
            font-size: 16px;
            font-weight: 600;
        }
        
        .uw-a11y-explanation-body ul {
            margin: 10px 0;
            padding-left: 20px;
        }
        
        .uw-a11y-explanation-body li {
            margin: 8px 0;
        }
        
        .uw-a11y-explanation-note {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 15px;
            margin-top: 20px;
            font-size: 14px;
        }
        
        @media (max-width: 768px) {
            .uw-a11y-explanation-content {
                margin: 10px;
                max-height: 90vh;
            }
            
            .uw-a11y-explanation-header,
            .uw-a11y-explanation-body {
                padding-left: 15px;
                padding-right: 15px;
            }
        }
        
        /* Tab order visualization styles */
        .uw-a11y-tab-order-overlay {
            pointer-events: none;
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 999998;
        }
        
        .uw-a11y-tab-indicator {
            position: absolute;
            background: #ff6b35;
            color: white;
            border-radius: 50%;
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: bold;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            z-index: 999999;
            pointer-events: none;
            transform: translate(-50%, -50%);
            animation: uw-tab-indicator-appear 0.3s ease-out forwards;
        }
        
        .uw-a11y-tab-indicator:nth-child(odd) {
            background: #ff6b35;
        }
        
        .uw-a11y-tab-indicator:nth-child(even) {
            background: #4285f4;
        }
        
        @keyframes uw-tab-indicator-appear {
            from {
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.5);
            }
            to {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
            }
        }
        
        /* Enhanced navigation button state for tab order */
        #uw-a11y-nav ul li a.active {
            background: rgba(255,255,255,0.25);
            box-shadow: inset 0 0 0 2px rgba(255,255,255,0.3);
        }
        
        /* Inspector Tools styles */
        .uw-a11y-inspector {
            padding: 0;
        }
        
        .uw-a11y-inspector h3 {
            margin: 0 0 0.5rem 0;
            color: #333;
            font-size: 18px;
            font-weight: 600;
        }

        .uw-a11y-inspector-hub > p {
            margin: 0 0 1.5rem 0;
            color: #666;
            font-size: 14px;
            line-height: 1.5;
        }

        .uw-a11y-inspector-tool-row {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 12px 14px;
            margin-bottom: 8px;
        }

        .uw-a11y-inspector-tool-row-main {
            flex: 1;
            min-width: 0;
        }

        .uw-a11y-inspector-tool-row .uw-a11y-inspector-tool-open {
            flex-shrink: 0;
            align-self: center;
        }

        .uw-a11y-inspector-tool-row h4 {
            margin: 0 0 4px 0;
            color: #333;
            font-size: 14px;
            font-weight: 600;
        }

        .uw-a11y-inspector-tool-teaser {
            margin: 0 0 2px 0;
            color: #666;
            font-size: 12px;
            line-height: 1.4;
        }

        .uw-a11y-inspector-hub-status {
            margin: 0;
            font-size: 11px;
            line-height: 1.4;
            color: #6b7280;
            font-weight: 500;
        }

        /* Compact slide-toggle row used for overlay tools (Tab Order, Focus
           Indicators, Landmark Structure) and the alt-text overlay control.
           Mirrors the Settings .uw-a11y-pref-row pattern. */
        .uw-a11y-inspector-toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 12px 14px;
            margin-bottom: 8px;
        }

        .uw-a11y-inspector-toggle-row--inline {
            background: transparent;
            border: 1px solid rgba(0,0,0,0.08);
            margin-top: 8px;
            margin-bottom: 12px;
        }

        .uw-a11y-inspector-toggle-main {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .uw-a11y-inspector-toggle-main h4 {
            margin: 0;
            color: #333;
            font-size: 14px;
            font-weight: 600;
        }

        .uw-a11y-inspector-toggle-main p {
            margin: 0;
            color: #666;
            font-size: 12px;
            line-height: 1.4;
        }

        .uw-a11y-inspector-toggle-main .uw-a11y-inspector-status {
            margin-top: 2px;
        }

        /* Compact section header for sub-page detail panels */
        .uw-a11y-inspector-section-header {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 6px;
        }

        .uw-a11y-inspector-section-header h4 {
            margin: 0;
        }

        .uw-a11y-inspector-detail-header {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 1rem;
        }

        .uw-a11y-inspector-back-btn,
        .uw-a11y-inspector-tool-open {
            flex-shrink: 0;
            padding: 0.5rem;
            min-width: 2.5rem;
            justify-content: center;
        }

        .uw-a11y-inspector-back-btn svg,
        .uw-a11y-inspector-tool-open svg {
            flex-shrink: 0;
        }

        .uw-a11y-inspector-detail-heading {
            margin: 0;
            flex: 1;
            min-width: 0;
            color: #333;
            font-size: 18px;
            font-weight: 600;
        }

        .uw-a11y-inspector-detail-panel > .uw-a11y-inspector-section:last-child {
            margin-bottom: 0;
        }
        
        .uw-a11y-inspector-section {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1rem;
        }
        
        .uw-a11y-inspector-section h4 {
            margin: 0 0 0.5rem 0;
            color: #333;
            font-size: 16px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .uw-a11y-inspector-section p {
            margin: 0 0 1rem 0;
            color: #666;
            font-size: 14px;
            line-height: 1.4;
        }
        
        .uw-a11y-inspector-controls {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        .uw-a11y-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
            text-decoration: none;
        }
        
        .uw-a11y-btn-secondary {
            background: white;
            color: #495057;
            border: 1px solid #ced4da;
        }
        
        .uw-a11y-btn-secondary:hover:not(:disabled) {
            background: #e9ecef;
            border-color: #adb5bd;
        }
        
        .uw-a11y-btn-secondary:focus:not(:disabled) {
            outline: 2px solid #4f46e5;
            outline-offset: 2px;
        }

        .uw-a11y-btn-secondary.active {
            background: #4f46e5;
            color: white;
            border-color: #4f46e5;
        }

        .uw-a11y-btn-secondary.active:hover {
            background: #4338ca;
            border-color: #4338ca;
        }
        
        .uw-a11y-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        .uw-a11y-inspector-status {
            font-size: 14px;
            color: #666;
            font-weight: 500;
        }

        /* Outline View styles */
        .uw-a11y-outline-tree {
            margin-top: 0.75rem;
            border-top: 1px solid #e9ecef;
            padding-top: 0.5rem;
        }

        .uw-a11y-outline-list {
            display: flex;
            flex-direction: column;
            gap: 1px;
        }

        .uw-a11y-outline-item {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            background: none;
            border: none;
            border-radius: 6px;
            padding: 5px 8px;
            cursor: pointer;
            text-align: left;
            font-family: inherit;
            font-size: 13px;
            color: #374151;
            box-sizing: border-box;
            transition: background 0.12s;
        }

        .uw-a11y-outline-item:hover {
            background: rgba(79,70,229,0.06);
        }

        .uw-a11y-outline-item:focus-visible {
            outline: 2px solid #4f46e5;
            outline-offset: 1px;
        }

        .uw-a11y-outline-badge {
            flex-shrink: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 700;
            padding: 2px 5px;
            border-radius: 4px;
            letter-spacing: 0.04em;
            min-width: 24px;
            line-height: 1.4;
        }

        .uw-a11y-outline-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
            line-height: 1.4;
        }

        .uw-a11y-outline-empty-text {
            color: #9ca3af;
            font-style: italic;
        }

        .uw-a11y-outline-skip {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            color: #92400e;
            background: #fffbeb;
            border-left: 3px solid #f59e0b;
            border-radius: 0 6px 6px 0;
            font-size: 12px;
            font-weight: 500;
            margin: 3px 0;
        }

        .uw-a11y-outline-skip svg {
            stroke: #d97706;
            flex-shrink: 0;
        }

        /* Link List styles */
        .uw-a11y-link-row {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            width: 100%;
            background: none;
            border: none;
            border-radius: 6px;
            padding: 6px 8px;
            cursor: pointer;
            text-align: left;
            font-family: inherit;
            font-size: 13px;
            color: #374151;
            box-sizing: border-box;
            transition: background 0.12s;
        }

        .uw-a11y-link-row:hover {
            background: rgba(79,70,229,0.06);
        }

        .uw-a11y-link-row:focus-visible {
            outline: 2px solid #4f46e5;
            outline-offset: 1px;
        }

        .uw-a11y-link-row.has-issue {
            background: rgba(239,68,68,0.04);
        }

        .uw-a11y-link-row.has-issue:hover {
            background: rgba(239,68,68,0.10);
        }

        .uw-a11y-link-badge {
            flex-shrink: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 700;
            padding: 2px 5px;
            border-radius: 4px;
            letter-spacing: 0.04em;
            min-width: 32px;
            line-height: 1.4;
            margin-top: 2px;
        }

        .uw-a11y-link-main {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            flex: 1;
        }

        .uw-a11y-link-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            line-height: 1.4;
            font-weight: 500;
        }

        .uw-a11y-link-name.is-empty {
            color: #b91c1c;
            font-style: italic;
            font-weight: 400;
        }

        .uw-a11y-link-url {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            line-height: 1.3;
            font-size: 11px;
            color: #9ca3af;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }

        .uw-a11y-link-issues {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            color: #b45309;
            line-height: 1.3;
            margin-top: 2px;
        }

        .uw-a11y-link-issues svg {
            stroke: #d97706;
            flex-shrink: 0;
        }

        .uw-a11y-alt-decorative {
            color: #1d4ed8;
            font-style: italic;
            font-size: 12px;
            line-height: 1.4;
        }

        /* Color Blindness Simulation styles */
        .uw-a11y-cvd-list {
            margin: 0.75rem 0 0;
            padding: 0;
            border: none;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .uw-a11y-cvd-option {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 10px;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.12s;
            border: 1px solid transparent;
        }

        .uw-a11y-cvd-option:hover {
            background: rgba(79,70,229,0.06);
        }

        .uw-a11y-cvd-option:has(input:checked) {
            background: rgba(79,70,229,0.10);
            border-color: rgba(79,70,229,0.35);
        }

        .uw-a11y-cvd-option:focus-within {
            outline: 2px solid #4f46e5;
            outline-offset: 1px;
        }

        .uw-a11y-cvd-option input[type="radio"] {
            flex-shrink: 0;
            margin: 0;
            accent-color: #4f46e5;
            width: 16px;
            height: 16px;
        }

        .uw-a11y-cvd-main {
            display: flex;
            flex-direction: column;
            gap: 1px;
            min-width: 0;
            flex: 1;
        }

        .uw-a11y-cvd-name {
            font-size: 13px;
            font-weight: 600;
            color: #111827;
            line-height: 1.4;
        }

        .uw-a11y-cvd-meta {
            font-size: 11px;
            color: #6b7280;
            line-height: 1.3;
        }

        /* Contrast checker */
        .uw-a11y-contrast-pick-row {
            margin: 0 0 10px 0;
        }

        .uw-a11y-contrast-fields {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin: 0;
        }

        .uw-a11y-contrast-field {
            background: #fff;
            border: 1px solid #e9ecef;
            border-radius: 6px;
            padding: 10px;
        }

        .uw-a11y-contrast-field-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 8px;
        }

        .uw-a11y-contrast-field-label {
            font-size: 13px;
            font-weight: 600;
            color: #111827;
        }

        .uw-a11y-contrast-pick {
            padding: 4px 10px;
            font-size: 12px;
        }

        .uw-a11y-contrast-input-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .uw-a11y-contrast-color {
            width: 36px;
            height: 28px;
            padding: 0;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: #fff;
            cursor: pointer;
            flex-shrink: 0;
        }

        .uw-a11y-contrast-hex {
            flex: 1;
            min-width: 0;
            padding: 6px 8px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font: 13px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            text-transform: uppercase;
            color: #111827;
            background: #fff;
        }

        .uw-a11y-contrast-hex:focus {
            outline: 2px solid #4f46e5;
            outline-offset: 1px;
        }

        .uw-a11y-contrast-controls-row {
            display: flex;
            gap: 8px;
            margin-top: 10px;
        }

        .uw-a11y-contrast-controls-row .uw-a11y-btn {
            padding: 4px 10px;
            font-size: 12px;
        }

        .uw-a11y-contrast-preview {
            margin-top: 12px;
            padding: 14px 12px;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            display: flex;
            align-items: baseline;
            gap: 12px;
            min-height: 60px;
            transition: background 0.15s, color 0.15s;
        }

        .uw-a11y-contrast-preview-large {
            font-size: 28px;
            font-weight: 700;
            line-height: 1;
            flex-shrink: 0;
        }

        .uw-a11y-contrast-preview-normal {
            font-size: 13px;
            line-height: 1.4;
        }

        .uw-a11y-contrast-result {
            margin-top: 12px;
            background: #fff;
            border: 1px solid #e9ecef;
            border-radius: 6px;
            padding: 12px;
        }

        .uw-a11y-contrast-ratio {
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid #f1f3f5;
        }

        .uw-a11y-contrast-ratio-value {
            font-size: 28px;
            font-weight: 700;
            color: #111827;
            line-height: 1;
        }

        .uw-a11y-contrast-ratio-label {
            font-size: 12px;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }

        .uw-a11y-contrast-checks {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .uw-a11y-contrast-checks li {
            display: grid;
            grid-template-columns: 56px 1fr auto;
            align-items: center;
            gap: 10px;
            padding: 6px 8px;
            border-radius: 4px;
            background: #f8f9fa;
            font-size: 13px;
        }

        .uw-a11y-contrast-check-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            padding: 2px 8px;
            border-radius: 999px;
            background: #e5e7eb;
            color: #374151;
        }

        .uw-a11y-contrast-checks li.is-pass .uw-a11y-contrast-check-badge {
            background: #d1fae5;
            color: #065f46;
        }

        .uw-a11y-contrast-checks li.is-fail .uw-a11y-contrast-check-badge {
            background: #fee2e2;
            color: #991b1b;
        }

        .uw-a11y-contrast-check-label {
            color: #111827;
        }

        .uw-a11y-contrast-check-req {
            font-size: 12px;
            color: #6b7280;
            font-variant-numeric: tabular-nums;
        }

        /* ── Guided / Advanced view toggle ────────────────────────────── */
        #uw-a11y-results-header {
            margin-bottom: 14px;
        }

        .uw-a11y-view-toggle {
            display: inline-flex;
            background: rgba(0,0,0,0.05);
            border-radius: 999px;
            padding: 3px;
            gap: 2px;
        }

        .uw-a11y-view-toggle-btn {
            background: transparent;
            border: none;
            padding: 6px 14px;
            font: 600 13px/1 inherit;
            color: #555;
            border-radius: 999px;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
        }

        .uw-a11y-view-toggle-btn:hover {
            color: #111827;
        }

        .uw-a11y-view-toggle-btn.is-active {
            background: #fff;
            color: #4f46e5;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }

        .uw-a11y-view-toggle-btn:focus-visible {
            outline: 2px solid #4f46e5;
            outline-offset: 2px;
        }

        /* Mode-driven show/hide */
        #uw-a11y-view-results[data-results-mode="guided"] #uw-a11y-results,
        #uw-a11y-view-results[data-results-mode="guided"] .uw-a11y-advanced-only {
            display: none;
        }

        #uw-a11y-view-results[data-results-mode="advanced"] #uw-a11y-guided {
            display: none;
        }

        /* ── Guided "Top things to fix" landing ───────────────────────── */
        .uw-a11y-guided-wrap {
            background: #f8f9fa;
            border-radius: 14px;
            padding: 18px;
            border: 1px solid rgba(0,0,0,0.05);
        }

        .uw-a11y-guided-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 14px;
        }

        .uw-a11y-guided-heading {
            margin: 0;
            font-size: 16px;
            font-weight: 700;
            color: #111827;
        }

        .uw-a11y-guided-count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 24px;
            height: 24px;
            padding: 0 8px;
            border-radius: 999px;
            background: #dc6002;
            color: #fff;
            font-size: 12px;
            font-weight: 700;
        }

        .uw-a11y-guided-cards {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 14px;
        }

        .uw-a11y-guided-card {
            display: grid;
            grid-template-columns: 40px 1fr 20px;
            align-items: center;
            gap: 14px;
            padding: 14px 16px;
            background: #fff;
            border: 1px solid rgba(0,0,0,0.06);
            border-radius: 12px;
            text-align: left;
            cursor: pointer;
            font-family: inherit;
            transition: border-color 0.15s, box-shadow 0.15s, transform 0.05s;
        }

        .uw-a11y-guided-card:hover {
            border-color: rgba(79,70,229,0.4);
            box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        }

        .uw-a11y-guided-card:active {
            transform: translateY(1px);
        }

        .uw-a11y-guided-card:focus-visible {
            outline: 2px solid #4f46e5;
            outline-offset: 2px;
        }

        .uw-a11y-guided-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: 10px;
            background: #fde2e1;
            color: #dc2626;
            font-size: 18px;
            font-weight: 700;
        }

        .uw-a11y-guided-card.is-manual .uw-a11y-guided-icon {
            background: #fef3c7;
            color: #b45309;
        }

        .uw-a11y-guided-card-badge {
            display: inline-flex;
            align-items: center;
            margin-right: 8px;
            padding: 2px 7px;
            border-radius: 999px;
            background: #fef3c7;
            color: #b45309;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            line-height: 1.4;
            white-space: nowrap;
        }

        .uw-a11y-walk-badge {
            margin-left: 8px;
            margin-right: 0;
            font-size: 10px;
            vertical-align: middle;
        }

        .uw-a11y-guided-card-text {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }

        .uw-a11y-guided-card-title {
            font-size: 15px;
            font-weight: 700;
            color: #111827;
            line-height: 1.3;
        }

        .uw-a11y-guided-card-meta {
            font-size: 13px;
            color: #6b7280;
            line-height: 1.4;
        }

        .uw-a11y-guided-arrow {
            color: #9ca3af;
            font-size: 18px;
            line-height: 1;
            text-align: right;
        }

        .uw-a11y-guided-walkthrough {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            width: 100%;
            padding: 14px 18px;
            background: #4f46e5;
            color: #fff;
            border: none;
            border-radius: 12px;
            font: 700 15px/1 inherit;
            cursor: pointer;
            transition: background 0.15s, transform 0.05s;
        }

        .uw-a11y-guided-walkthrough:hover {
            background: #4338ca;
        }

        .uw-a11y-guided-walkthrough:active {
            transform: translateY(1px);
        }

        .uw-a11y-guided-walkthrough:focus-visible {
            outline: 2px solid #fff;
            outline-offset: 2px;
            box-shadow: 0 0 0 4px rgba(79,70,229,0.5);
        }

        .uw-a11y-guided-walk-icon {
            flex-shrink: 0;
        }

        .uw-a11y-guided-see-all {
            background: none;
            border: none;
            color: #4f46e5;
            font: inherit;
            font-weight: 500;
            cursor: pointer;
            padding: 0;
            text-decoration: underline;
        }

        .uw-a11y-guided-see-all:hover,
        .uw-a11y-guided-see-all:focus-visible {
            color: #3730a3;
        }

        /* "Show 3 more" link — secondary affordance below the walkthrough CTA. */
        .uw-a11y-guided-more {
            display: block;
            margin: 10px auto 0;
            background: none;
            border: none;
            color: #4f46e5;
            font: 600 13px/1 inherit;
            cursor: pointer;
            padding: 6px 4px;
        }

        .uw-a11y-guided-more:hover,
        .uw-a11y-guided-more:focus-visible {
            text-decoration: underline;
        }

        /* Subdued note steering technical users to Advanced view without
           tempting novices into it. Smaller text, muted color, inline link. */
        .uw-a11y-guided-advanced-note {
            margin: 14px 0 0;
            padding: 10px 12px;
            background: rgba(0,0,0,0.03);
            border-radius: 8px;
            color: #6b7280;
            font-size: 12px;
            line-height: 1.5;
            text-align: center;
        }

        .uw-a11y-guided-advanced-note .uw-a11y-link-btn {
            color: #4f46e5;
        }

        .uw-a11y-guided-empty {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 12px;
            padding: 18px;
            text-align: center;
        }

        .uw-a11y-guided-empty h3 {
            margin: 0 0 6px;
            color: #065f46;
            font-size: 16px;
        }

        .uw-a11y-guided-empty p {
            margin: 0 0 10px;
            color: #047857;
            font-size: 13px;
        }

        .uw-a11y-guided-empty--neutral {
            background: #f8f9fa;
            border-color: rgba(0,0,0,0.08);
        }

        .uw-a11y-guided-empty--neutral h3 { color: #111827; }
        .uw-a11y-guided-empty--neutral p { color: #4b5563; }

        /* ── Walkthrough (stepped one-issue-at-a-time view) ───────────── */
        .uw-a11y-walkthrough {
            background: #fff;
            border: 1px solid rgba(0,0,0,0.08);
            border-radius: 14px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.06);
            overflow: hidden;
        }

        .uw-a11y-walk-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 10px 14px;
            background: #f8f9fa;
            border-bottom: 1px solid rgba(0,0,0,0.06);
        }

        .uw-a11y-walk-back,
        .uw-a11y-walk-close {
            background: none;
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            color: #555;
            font-size: 16px;
            border-radius: 6px;
        }

        .uw-a11y-walk-back:hover,
        .uw-a11y-walk-close:hover {
            background: rgba(0,0,0,0.05);
            color: #111827;
        }

        .uw-a11y-walk-step {
            font-size: 12px;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }

        .uw-a11y-walk-body {
            padding: 18px;
        }

        .uw-a11y-walk-headline {
            margin: 0 0 6px;
            font-size: 18px;
            color: #111827;
        }

        .uw-a11y-walk-meta {
            margin: 0 0 14px;
            font-size: 13px;
            color: #6b7280;
        }

        .uw-a11y-walk-instance-pager {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin: 0 0 14px;
            padding: 6px 8px;
            background: rgba(79,70,229,0.06);
            border: 1px solid rgba(79,70,229,0.18);
            border-radius: 8px;
            font-size: 13px;
            color: #4b5563;
        }

        .uw-a11y-walk-instance-label {
            flex: 1;
            text-align: center;
        }

        .uw-a11y-walk-instance-label strong {
            color: #4f46e5;
            font-variant-numeric: tabular-nums;
        }

        .uw-a11y-walk-instance-progress {
            color: #6b7280;
            font-size: 12px;
            margin-left: 4px;
        }

        .uw-a11y-walk-instance-check {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            margin-left: 6px;
            border-radius: 999px;
            background: #10b981;
            color: #fff;
            font-size: 10px;
            font-weight: 700;
            vertical-align: middle;
        }

        .uw-a11y-walk-instance-pager button {
            background: #fff;
            border: 1px solid rgba(0,0,0,0.1);
            border-radius: 6px;
            width: 28px;
            height: 28px;
            cursor: pointer;
            color: #4f46e5;
            font-size: 16px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
        }

        .uw-a11y-walk-instance-pager button:hover:not(:disabled) {
            background: #4f46e5;
            color: #fff;
        }

        .uw-a11y-walk-instance-pager button:disabled {
            opacity: 0.35;
            cursor: not-allowed;
        }

        .uw-a11y-walk-fix {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 12px 14px;
            margin-bottom: 12px;
            font-size: 13px;
            line-height: 1.5;
        }

        .uw-a11y-walk-fix strong {
            display: block;
            margin-bottom: 4px;
            color: #111827;
        }

        .uw-a11y-walk-fix-body {
            color: #374151;
        }

        .uw-a11y-walk-details {
            margin-bottom: 12px;
            font-size: 13px;
        }

        .uw-a11y-walk-details summary {
            cursor: pointer;
            color: #4f46e5;
            font-weight: 600;
            padding: 4px 0;
        }

        .uw-a11y-walk-details p {
            margin: 6px 0 0;
            color: #4b5563;
            line-height: 1.5;
        }

        .uw-a11y-walk-learn {
            display: inline-block;
            margin-bottom: 12px;
            font-size: 13px;
            color: #4f46e5;
            text-decoration: none;
            font-weight: 600;
        }

        .uw-a11y-walk-learn:hover {
            text-decoration: underline;
        }

        .uw-a11y-walk-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        .uw-a11y-walk-actions .uw-a11y-walk-show {
            flex: 1;
            min-width: 140px;
        }

        .uw-a11y-walk-verify {
            flex: 1;
            min-width: 140px;
            justify-content: center;
            background: #4f46e5;
            color: #fff;
            border: none;
            font-weight: 700;
            transition: background 0.15s;
        }

        .uw-a11y-walk-verify:hover {
            background: #4338ca;
        }

        .uw-a11y-walk-verify.is-verified {
            background: #fff;
            color: #065f46;
            border: 1px solid #10b981;
            font-weight: 600;
        }

        .uw-a11y-walk-verify.is-verified:hover {
            filter: none;
            background: #f0fdf4;
        }

        .uw-a11y-walk-nav {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            padding: 12px 18px;
            border-top: 1px solid rgba(0,0,0,0.06);
            background: #fafafa;
        }

        .uw-a11y-walk-nav .uw-a11y-btn {
            min-width: 100px;
            justify-content: center;
        }

        .uw-a11y-walk-next {
            background: #4f46e5;
            color: #fff;
        }

        .uw-a11y-walk-next:hover {
            background: #4338ca;
        }

        .uw-a11y-walk-prev:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }

        .uw-a11y-coming-soon {
            background: #ffc107;
            color: #212529;
            font-size: 11px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 3px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .uw-a11y-inspector-placeholder {
            position: relative;
        }
        
        .uw-a11y-inspector-placeholder::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(45deg, transparent 40%, rgba(255,255,255,0.8) 50%, transparent 60%);
            pointer-events: none;
            border-radius: 8px;
        }
        </style>`;
        },

        // Check if user prefers reduced motion
        prefersReducedMotion: function() {
            return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        },

        // Load GSAP and initialize animations
        loadGSAP: function() {
            return new Promise((resolve, reject) => {
                // Check if user prefers reduced motion
                if (this.prefersReducedMotion()) {
                    console.log('🎯 Reduced motion preferred - animations disabled');
                    resolve(null);
                    return;
                }
                
                // Check if GSAP is already loaded (pre-loaded by content script)
                if (window.gsap) {
                    console.log('✅ GSAP already available (pre-loaded by extension)');
                    resolve(window.gsap);
                    return;
                }
                
                // Try to load GSAP from local bundle first (for browser extensions)
                this.tryLoadGsapFromExtension().then(success => {
                    if (success) {
                        console.log('✨ GSAP loaded successfully from extension bundle');
                        resolve(window.gsap);
                    } else {
                        
                    }
                }).catch(() => {
                    
                });
            });
        },

        // Try to load GSAP from extension bundle
        tryLoadGsapFromExtension: function() {
            return new Promise((resolve) => {
                // Check if we're running in a browser extension context
                if (!chrome || !chrome.runtime || !chrome.runtime.getURL) {
                    resolve(false);
                    return;
                }

                try {
                    const script = document.createElement('script');
                    script.src = chrome.runtime.getURL('gsap.min.js');
                    script.onload = () => resolve(true);
                    script.onerror = () => resolve(false);
                    document.head.appendChild(script);
                } catch (error) {
                    resolve(false);
                }
            });
        },

        

        // Setup initial height for smooth transitions
        setupInitialHeight: function() {
            const content = this.shadowRoot.getElementById('uw-a11y-content');
            if (!content) return;
            
            // Set initial height based on the first view (results)
            const initialHeight = this.measureViewHeight('results');
            const maxAllowedHeight = this.getMaxContentHeight();
            
            if (initialHeight) {
                content.style.height = initialHeight + 'px';
                content.style.maxHeight = maxAllowedHeight + 'px'; // Maintain max-height constraint
                // Keep vertical scrolling available; rely on CSS to show only when needed
                content.style.overflowY = 'auto';
            }
        },

        // Setup window resize handler to recalculate max heights
        setupResizeHandler: function() {
            if (this.resizeHandler) {
                window.removeEventListener('resize', this.resizeHandler);
            }
            
            this.resizeHandler = () => {
                const content = this.shadowRoot.getElementById('uw-a11y-content');
                if (!content) return;
                
                const maxAllowedHeight = this.getMaxContentHeight();
                const currentView = this.currentView || 'results';
                const idealHeight = this.measureViewHeight(currentView);
                const newHeight = Math.min(idealHeight, maxAllowedHeight);
                
                // Update max-height and current height if needed
                content.style.maxHeight = maxAllowedHeight + 'px';
                if (window.gsap && !this.prefersReducedMotion()) {
                    window.gsap.to(content, {
                        height: newHeight,
                        duration: 0.3,
                        ease: "power2.out"
                    });
                } else {
                    content.style.height = newHeight + 'px';
                }
                
                // Always allow vertical scroll so long lists remain accessible
                content.style.overflowY = 'auto';
            };
            
            window.addEventListener('resize', this.resizeHandler);
        },

        // Make the panel draggable by its header
        initDrag: function() {
            const wrapper = this.shadowRoot.getElementById('uw-a11y-wrapper');
            const header = this.shadowRoot.getElementById('uw-a11y-header');
            if (!wrapper || !header) return;

            let startX = 0, startY = 0, startLeft = 0, startTop = 0;
            const onPointerDown = (e) => {
                // Only left-click/primary pointer drags
                if (e.button !== undefined && e.button !== 0) return;
                // Disable dragging when docked
                if (wrapper.classList.contains('uw-a11y-docked-right')) return;
                // Do not start a drag when clicking header controls (close, etc.)
                if (e.target && e.target.closest && e.target.closest('.uw-a11y-header-buttons')) {
                    return; // allow normal button clicks
                }
                e.preventDefault();
                try { header.setPointerCapture(e.pointerId); } catch (_) {}

                const rect = wrapper.getBoundingClientRect();
                // Switch to left/top positioning for free dragging
                wrapper.style.right = 'auto';
                wrapper.style.left = rect.left + 'px';
                wrapper.style.top = rect.top + 'px';

                startX = e.clientX; startY = e.clientY;
                startLeft = rect.left; startTop = rect.top;

                const onPointerMove = (ev) => {
                    const dx = ev.clientX - startX;
                    const dy = ev.clientY - startY;
                    let newLeft = startLeft + dx;
                    let newTop = startTop + dy;
                    // Constrain within viewport
                    const maxLeft = Math.max(0, window.innerWidth - wrapper.offsetWidth);
                    const maxTop = Math.max(0, window.innerHeight - 40); // keep header reachable
                    newLeft = Math.min(Math.max(0, newLeft), maxLeft);
                    newTop = Math.min(Math.max(0, newTop), maxTop);
                    wrapper.style.left = newLeft + 'px';
                    wrapper.style.top = newTop + 'px';
                };

                const onPointerUp = () => {
                    document.removeEventListener('pointermove', onPointerMove);
                    document.removeEventListener('pointerup', onPointerUp);
                    try { header.releasePointerCapture(e.pointerId); } catch (_) {}
                    // Persist position
                    try {
                        const pos = { left: parseInt(wrapper.style.left || '0', 10) || 0, top: parseInt(wrapper.style.top || '0', 10) || 0 };
                        sessionStorage.setItem('uw-a11y-pos', JSON.stringify(pos));
                    } catch (_) {}
                };

                document.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointerup', onPointerUp);
            };

            header.addEventListener('pointerdown', onPointerDown);
        },

        // Apply previously saved position to the wrapper, if present
        applySavedPosition: function() {
            // Skip when docked — the dock CSS controls placement.
            if (this.getDockPosition() === 'right') return;
            try {
                const raw = sessionStorage.getItem('uw-a11y-pos');
                if (!raw) return;
                const pos = JSON.parse(raw);
                const wrapper = this.shadowRoot.getElementById('uw-a11y-wrapper');
                if (!wrapper || typeof pos !== 'object') return;
                if (typeof pos.left === 'number' && typeof pos.top === 'number') {
                    wrapper.style.right = 'auto';
                    wrapper.style.left = `${pos.left}px`;
                    wrapper.style.top = `${pos.top}px`;
                }
            } catch (_) { /* ignore */ }
        },

        // Animate the entire panel entrance
        animatePanel: function() {
            const wrapper = this.shadowRoot.getElementById('uw-a11y-wrapper');
            if (!wrapper) return;
            
            if (window.gsap && !this.prefersReducedMotion()) {
                // Use GSAP for enhanced animations - no delay needed
                window.gsap.to(wrapper, {
                    scale: 1,
                    opacity: 1,
                    y: 0,
                    duration: 0.5,
                    ease: "power3.out"
                });
            } else {
                // Use CSS animations as fallback or for reduced motion
                wrapper.classList.add('uw-a11y-css-animate');
                // Small delay to ensure DOM is ready
                setTimeout(() => {
                    wrapper.classList.add('uw-a11y-animate-in');
                }, 50);
            }
        },

        // Animate navigation items with stagger effect
        animateNavigation: function() {
            const navItems = this.shadowRoot.querySelectorAll('#uw-a11y-nav ul li');
            console.log('🎯 animateNavigation called, found', navItems.length, 'nav items');
            
            if (navItems.length === 0) {
                console.warn('❌ No navigation items found for animation');
                return;
            }
            
            if (window.gsap && !this.prefersReducedMotion()) {
                console.log('✨ Starting GSAP navigation animation');
                
                // Clear CSS transforms and let GSAP take full control
                navItems.forEach((item, index) => {
                    item.style.transform = '';
                    item.style.opacity = '';
                    console.log(`🔧 Cleared styles for nav item ${index + 1}`);
                });
                
                // Use GSAP for enhanced animations - set initial state and animate
                const tl = window.gsap.fromTo(navItems, 
                    {
                        x: -30, 
                        opacity: 0,
                        scale: 0.9
                    },
                    {
                        x: 0,
                        opacity: 1,
                        scale: 1,
                        duration: 0.6,
                        stagger: 0.1,
                        ease: "back.out(1.7)",
                        delay: 0.3,
                        onStart: () => console.log('🚀 GSAP nav animation started'),
                        onComplete: () => console.log('✅ GSAP nav animation completed')
                    }
                );
                
                console.log('📝 GSAP timeline created:', tl);
                
                // Add subtle hover animations with conflict prevention
                navItems.forEach(item => {
                    const link = item.querySelector('a');
                    if (!link) return;
                    
                    link.addEventListener('mouseenter', () => {
                        // Don't animate during view transitions or if reduced motion is preferred
                        if (this.isAnimating || this.prefersReducedMotion()) return;
                        
                        window.gsap.to(item, {
                            scale: 1.05,
                            duration: 0.3,
                            ease: "power2.out",
                            overwrite: "auto"
                        });
                    });
                    
                    link.addEventListener('mouseleave', () => {
                        // Don't animate if reduced motion is preferred
                        if (this.prefersReducedMotion()) return;
                        
                        window.gsap.to(item, {
                            scale: 1,
                            duration: 0.3,
                            ease: "power2.out",
                            overwrite: "auto"
                        });
                    });
                });
            } else {
                // Use CSS animations as fallback or for reduced motion
                navItems.forEach(item => {
                    item.classList.add('uw-a11y-css-animate');
                });
                
                // Small delay to ensure DOM is ready, then trigger staggered animation
                setTimeout(() => {
                    navItems.forEach((item, index) => {
                        setTimeout(() => {
                            item.classList.add('uw-a11y-animate-in');
                        }, index * 100); // 100ms stagger
                    });
                }, 100);
            }
        },

        // Calculate the maximum allowed content height
        getMaxContentHeight: function() {
            // Account for the wrapper's actual layout: 20px top offset + 4px wrapper
            // padding + ~60px header + 4px wrapper padding + 20px bottom breathing room.
            // Using 0.85vh would leave ~100px of usable viewport unused on tall windows
            // and force a tiny scrollbar even when there's room to grow.
            const maxHeight = window.innerHeight - 108;
            return Math.max(200, maxHeight);
        },

        // Measure the height of a specific view section with max-height constraint
        measureViewHeight: function(viewName) {
            const viewEl = this.shadowRoot.getElementById(`uw-a11y-view-${viewName}`);
            if (!viewEl) return null;
            
            // Temporarily show the element to measure its height
            const wasHidden = viewEl.hasAttribute('hidden');
            const originalStyles = {
                position: viewEl.style.position,
                visibility: viewEl.style.visibility,
                height: viewEl.style.height
            };
            
            // Make it measurable but invisible
            viewEl.removeAttribute('hidden');
            viewEl.style.position = 'absolute';
            viewEl.style.visibility = 'hidden';
            viewEl.style.height = 'auto';
            
            // Measure the natural height
            const naturalHeight = viewEl.scrollHeight;
            const maxAllowedHeight = this.getMaxContentHeight();
            
            // Add a small padding so short rounding differences don't cause tiny scrollbars
            const padded = naturalHeight + (this.heightPadding || 0);
            // Use the smaller of padded height or max allowed height
            const targetHeight = Math.min(padded, maxAllowedHeight);
            
            // Restore original state
            if (wasHidden) viewEl.setAttribute('hidden', '');
            viewEl.style.position = originalStyles.position;
            viewEl.style.visibility = originalStyles.visibility;
            viewEl.style.height = originalStyles.height;
            
            return targetHeight;
        },

        // Animate the panel height transition
        animatePanelHeight: function(targetHeight) {
            if (!window.gsap) return Promise.resolve();
            
            const content = this.shadowRoot.getElementById('uw-a11y-content');
            if (!content) return Promise.resolve();
            
            // Kill any existing height animations
            window.gsap.killTweensOf(content);
            
            return new Promise((resolve) => {
                window.gsap.to(content, {
                    height: targetHeight,
                    duration: 0.4,
                    ease: "power2.inOut",
                    onComplete: resolve
                });
            });
        },

        // Animate navigation view transitions with height changes
        animateViewTransition: function(currentView, newView) {
            if (!window.gsap) return Promise.resolve();
            
            const currentEl = this.shadowRoot.getElementById(`uw-a11y-view-${currentView}`);
            const newEl = this.shadowRoot.getElementById(`uw-a11y-view-${newView}`);
            const content = this.shadowRoot.getElementById('uw-a11y-content');
            
            return new Promise((resolve) => {
                // Kill any existing animations on these elements
                if (currentEl) window.gsap.killTweensOf(currentEl);
                if (newEl) window.gsap.killTweensOf(newEl);
                if (content) window.gsap.killTweensOf(content);
                
                if (!currentEl || !newEl || currentView === newView) {
                    resolve();
                    return;
                }
                
                // Measure the target height for the new view
                const targetHeight = this.measureViewHeight(newView);
                if (!targetHeight) {
                    resolve();
                    return;
                }
                
                // Animate current view out and start height transition
                window.gsap.to(currentEl, {
                    opacity: 0,
                    y: -10,
                    duration: 0.2,
                    ease: "power2.in",
                    onComplete: () => {
                        // Switch visibility
                        currentEl.setAttribute('hidden', '');
                        newEl.removeAttribute('hidden');
                        
                        // Ensure we don't exceed max height and manage overflow
                        const maxAllowedHeight = this.getMaxContentHeight();
                        const finalHeight = Math.min(targetHeight, maxAllowedHeight);
                        
                        // Keep vertical scrolling enabled; browser will show scrollbar only if needed
                        content.style.overflowY = 'auto';
                        
                        // Animate height change and new view in simultaneously
                        const heightTween = window.gsap.to(content, {
                            height: finalHeight,
                            duration: 0.4,
                            ease: "power2.inOut"
                        });
                        
                        // Animate new view in
                        window.gsap.fromTo(newEl, 
                            { opacity: 0, y: 10 },
                            { 
                                opacity: 1, 
                                y: 0,
                                duration: 0.3,
                                ease: "power2.out",
                                delay: 0.1,
                                onComplete: resolve
                            }
                        );
                    }
                });
            });
        },

        // Initialize left-hand navigation
        initNavigation: function() {
            // Initialize current view tracker
            this.currentView = null;
            this.isAnimating = false;
            
            const map = [
                { id: 'uw-a11y-nav-results', view: 'results' },
                { id: 'uw-a11y-nav-history', view: 'history' },
                { id: 'uw-a11y-nav-inspector', view: 'inspector' },
                { id: 'uw-a11y-nav-settings', view: 'settings' },
                { id: 'uw-a11y-nav-help', view: 'help' },
                { id: 'uw-a11y-nav-about', view: 'about' }
            ];
            map.forEach(({ id, view }) => {
                const link = this.shadowRoot.getElementById(id);
                if (link) {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        // Prevent rapid clicking during animations
                        if (this.isAnimating) return;
                        this.showView(view);
                    });
                }
            });
            
            // Default to results
            this.showView('results');
        },

        // Show a specific view and update nav state
        showView: function(view) {
            const views = ['results', 'history', 'inspector', 'settings', 'help', 'about'];
            const currentView = this.currentView;
            
            // Don't do anything if we're already on this view or currently animating
            if (currentView === view || this.isAnimating) return;

            if (view === 'inspector' || currentView === 'inspector') {
                this.resetInspectorToHub();
            }
            
            // Update current view tracker
            this.currentView = view;
            
            // Update nav links active state first (without animation conflicts)
            this.updateNavActiveState(view);
            
            // Check if animations should be used
            const shouldAnimate = window.gsap && currentView && currentView !== view && !this.prefersReducedMotion();
            
            if (view === 'history') this.renderHistoryView();

            if (shouldAnimate) {
                this.isAnimating = true;
                this.animateViewTransition(currentView, view).then(() => {
                    this.isAnimating = false;
                    if (view === 'results') {
                        // Run score animation after the results view is visible
                        this.startResultsScoreAnimation();
                    }
                });
            } else {
                // Instant transition for reduced motion or no GSAP
                views.forEach(v => {
                    const el = this.shadowRoot.getElementById(`uw-a11y-view-${v}`);
                    if (!el) return;
                    if (v === view) {
                        el.removeAttribute('hidden');
                    } else {
                        el.setAttribute('hidden', '');
                    }
                });
                
                // Instantly adjust height if needed
                if (currentView && currentView !== view) {
                    const content = this.shadowRoot.getElementById('uw-a11y-content');
                    if (content) {
                        const targetHeight = this.measureViewHeight(view);
                        const maxAllowedHeight = this.getMaxContentHeight();
                        const finalHeight = Math.min(targetHeight, maxAllowedHeight);
                        
                        content.style.height = finalHeight + 'px';
                        content.style.overflowY = 'auto';
                    }
                }

                if (view === 'results') {
                    this.startResultsScoreAnimation();
                }
            }
        },

        // Update navigation active state without animation conflicts
        updateNavActiveState: function(activeView) {
            const views = ['results', 'history', 'inspector', 'settings', 'help', 'about'];
            
            views.forEach(v => {
                const link = this.shadowRoot.getElementById(`uw-a11y-nav-${v}`);
                if (!link) return;
                
                // Kill any existing GSAP animations on this link
                if (window.gsap) {
                    window.gsap.killTweensOf(link);
                }
                
                if (v === activeView) {
                    link.classList.add('active');
                    link.setAttribute('aria-current', 'page');
                } else {
                    link.classList.remove('active');
                    link.removeAttribute('aria-current');
                    // Reset any inline styles that GSAP might have added
                    if (window.gsap) {
                        window.gsap.set(link, { backgroundColor: '' });
                    }
                }
            });
        },

        // SETTINGS: defaults and persistence
        // Always-excluded internal selectors (not user-configurable)
        getEssentialExcludeSelectors: function() {
            return [
                '#uw-a11y-container',
                '#uw-a11y-panel',
                '.uw-a11y-highlight',
                '[id^="uw-a11y-"]',
                '[class*="uw-a11y-"]',
                '#uw-a11y-global-styles'
            ];
        },
        // Default user-adjustable excludes (shown in Settings).
        // Historically included '#wpadminbar' to skip the WordPress admin bar
        // by default. With platform detection + the WordPress preset that nudge
        // is now site-aware: WP users get a green "Apply WordPress preset" pill
        // on detected WP pages, and the preset itself adds the admin-bar
        // selectors. Keeping `#wpadminbar` as a global default would also
        // accidentally silence any non-WP page that happened to use that id.
        getDefaultExcludeSelectors: function() {
            return [];
        },

        getSettingsKey: function() { return 'uw-a11y-settings'; },

        loadSettings: function() {
            try {
                const json = localStorage.getItem(this.getSettingsKey());
                if (!json) return {};
                const parsed = JSON.parse(json);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (_) { return {}; }
        },

        saveSettings: function(settings) {
            try {
                localStorage.setItem(this.getSettingsKey(), JSON.stringify(settings || {}));
            } catch (_) { /* ignore quota errors */ }
        },

        // Per-origin map of pickerScopeId → structural selector. Lets us
        // re-stamp data-pinpoint-scope attributes after a page navigation
        // (the attribute is dynamic; the structural selector survives in
        // localStorage). If the structural selector matches nothing on the
        // new page we clear the scope rather than silently bypass it.
        getPickerScopeFallbacks: function() {
            try {
                const json = localStorage.getItem(this.getSettingsKey() + ':scope-fallbacks');
                if (!json) return {};
                const parsed = JSON.parse(json);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (_) { return {}; }
        },

        savePickerScopeFallbacks: function(map) {
            try {
                localStorage.setItem(this.getSettingsKey() + ':scope-fallbacks', JSON.stringify(map || {}));
            } catch (_) { /* ignore */ }
        },

        savePickerScopeFallback: function(scopeId, structuralSelector) {
            const map = this.getPickerScopeFallbacks();
            map[scopeId] = structuralSelector;
            this.savePickerScopeFallbacks(map);
        },

        // ── Platform preset registry & per-hostname memory ────────────────
        // Each preset declares the selectors it ADDS to the user's manual
        // scope/exclude entries — they're additive, not a replacement. The
        // user's typed entries are global; preset effects are scoped to the
        // current hostname via getActivePresetForCurrentHost().
        getPlatformPresets: function() {
            // Each preset:
            //   scope        — selectors layered into Scan Scope unconditionally
            //                  (active in BOTH "Whole page" and "Just the content" modes)
            //   exclude      — selectors layered into Exclude unconditionally
            //   contentScope — additional scope applied ONLY when "Just the content"
            //                  mode is selected. Lets a content editor on WordPress /
            //                  Drupal / etc. limit the audit to the page area they
            //                  actually control.
            //   hintMode     — which mode the green "Apply" pill should activate
            //                  when the user accepts the platform-detection nudge.
            //                  Defaults to 'whole'. Set to 'content' for platforms
            //                  whose useful contribution is only meaningful in
            //                  content mode (e.g. LibGuides — see note below).
            //
            // LibGuides note: a guide page IS the content already; there's no admin
            // bar to exclude on the public side. So "Whole page" mode is a no-op
            // (empty scope, empty exclude) and the useful application is
            // "Just the content" → scope to the three Springshare public
            // containers (#s-lib-public-header, #s-lib-public-nav,
            // #s-lib-public-main). Together they cover guide branding, the
            // guide nav, and the body — but not the surrounding institutional
            // header/footer, the alert/popover utilities, or the back-to-top
            // helper, which the guide author can't change.
            return {
                wordpress:   { label: 'WordPress',   scope: '', exclude: '#wpadminbar, #adminmenuwrap, #adminmenuback, #adminmenumain, #wpfooter', contentScope: 'main, .entry-content, article',  hintMode: 'whole' },
                drupal:      { label: 'Drupal',      scope: '', exclude: '#toolbar-administration, .toolbar-bar, .toolbar-tray',                  contentScope: 'main, .node__content, .region-content', hintMode: 'whole' },
                squarespace: { label: 'Squarespace', scope: '', exclude: '.sqs-announcement-bar-dropzone, .sqs-cookie-banner-v2',                 contentScope: 'main, #content',                  hintMode: 'whole' },
                wix:         { label: 'Wix',         scope: '', exclude: '#WIX_ADS, #SITE_HEADER, .wixAds',                                       contentScope: '#PAGES_CONTAINER, main',          hintMode: 'whole' },
                shopify:     { label: 'Shopify',     scope: '', exclude: '.shopify-section--announcement-bar, #preview-bar-iframe, #admin-bar-iframe', contentScope: 'main, #MainContent',         hintMode: 'whole' },
                joomla:      { label: 'Joomla',      scope: '', exclude: '#atum-sidebar, .atum-contract, #subhead-container',                     contentScope: 'main, #content',                  hintMode: 'whole' },
                webflow:     { label: 'Webflow',     scope: '', exclude: '.w-webflow-badge',                                                      contentScope: 'main',                            hintMode: 'whole' },
                libguides:   { label: 'LibGuides',   scope: '', exclude: '',                                                                       contentScope: '#s-lib-public-header, #s-lib-public-nav, #s-lib-public-main', hintMode: 'content' }
            };
        },

        getHostPresetsStorageKey: function() { return 'uw-a11y-host-presets'; },

        getCurrentHostname: function() {
            try { return location.hostname || ''; } catch (_) { return ''; }
        },

        loadHostPresets: function() {
            try {
                const raw = localStorage.getItem(this.getHostPresetsStorageKey());
                if (!raw) return {};
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                console.warn('[Pinpoint] host-preset load failed:', e && e.message ? e.message : e);
                return {};
            }
        },

        saveHostPresets: function(map) {
            try {
                localStorage.setItem(this.getHostPresetsStorageKey(), JSON.stringify(map || {}));
            } catch (e) {
                console.warn('[Pinpoint] host-preset save failed:', e && e.message ? e.message : e);
            }
        },

        // Per-host record shape: { preset: string, mode: 'whole' | 'content' }.
        // Legacy strings (just the preset name) are normalized to whole-page
        // mode. `null` means no preset is configured for the host.
        getActivePresetEntryForCurrentHost: function() {
            const map = this.loadHostPresets();
            const host = this.getCurrentHostname();
            if (!host) return null;
            const raw = map[host];
            if (!raw) return null;
            const presets = this.getPlatformPresets();
            // Back-compat: legacy storage stored a bare preset name string.
            if (typeof raw === 'string') {
                return presets[raw] ? { preset: raw, mode: 'whole' } : null;
            }
            if (raw && typeof raw === 'object' && presets[raw.preset]) {
                return { preset: raw.preset, mode: raw.mode === 'content' ? 'content' : 'whole' };
            }
            return null;
        },

        getActivePresetForCurrentHost: function() {
            const e = this.getActivePresetEntryForCurrentHost();
            return e ? e.preset : null;
        },

        getActivePresetModeForCurrentHost: function() {
            const e = this.getActivePresetEntryForCurrentHost();
            return e ? e.mode : 'whole';
        },

        setActivePresetForCurrentHost: function(name, mode) {
            const map = this.loadHostPresets();
            const host = this.getCurrentHostname();
            if (!host) return;
            if (name && this.getPlatformPresets()[name]) {
                map[host] = { preset: name, mode: mode === 'content' ? 'content' : 'whole' };
            } else {
                delete map[host];
            }
            this.saveHostPresets(map);
        },

        // ── Platform detection (results-view hint) ───────────────────────
        // Best-effort detection of the platform a page is built with, used
        // only to surface a subtle "Apply <Platform> preset?" hint in the
        // results view when no preset is currently active for this host.
        // Detection is conservative: each branch needs a high-confidence
        // signal (generator meta tag, distinctive global, or unmistakable
        // DOM marker) so we don't nag people on false positives.
        detectPlatform: function() {
            try {
                const gen = document.querySelector('meta[name="generator"], meta[name="Generator"]');
                const g = gen ? (gen.getAttribute('content') || '').toLowerCase() : '';

                // Generator meta — most authoritative signal.
                if (g.startsWith('wordpress'))   return 'wordpress';
                if (g.startsWith('drupal'))      return 'drupal';
                if (g.startsWith('squarespace')) return 'squarespace';
                if (g.startsWith('wix'))         return 'wix';
                if (g.startsWith('shopify'))     return 'shopify';
                if (g.startsWith('joomla'))      return 'joomla';
                if (g.startsWith('webflow'))     return 'webflow';
                if (g.includes('libguides') || g.includes('springshare')) return 'libguides';

                // DOM / runtime fallbacks. Each requires either a unique
                // identifier or a multi-signal combo to fire.
                if (document.getElementById('wpadminbar')) return 'wordpress';
                if (document.querySelector('link[href*="/wp-content/"], script[src*="/wp-content/"], script[src*="/wp-includes/"]')) return 'wordpress';

                if (document.getElementById('toolbar-administration')) return 'drupal';
                if (window.Drupal && window.Drupal.behaviors) return 'drupal';
                if (document.querySelector('script[src*="/sites/default/files/"], script[src*="/core/misc/drupal"]')) return 'drupal';

                if (window.Shopify && (window.Shopify.shop || window.Shopify.theme)) return 'shopify';
                if (document.querySelector('script[src*="cdn.shopify.com"], link[href*="cdn.shopify.com"]')) return 'shopify';

                if (document.querySelector('script[src*="static.parastorage.com"], script[src*=".wixstatic.com"]')) return 'wix';

                if (document.querySelector('script[src*="static.squarespace.com"], script[src*="squarespace-cdn.com"]')) return 'squarespace';

                if (document.querySelector('[data-wf-page], html.w-mod-js, script[src*="webflow.com"]')) return 'webflow';

                if (document.querySelector('script[src*="libapps.com"], script[src*="libguides.com"], [class^="s-lg-"], [class*=" s-lg-"], [class^="s-lib-public"], [class*=" s-lib-public"]')) return 'libguides';

                if (window.Joomla || document.querySelector('script[src*="/media/system/js/"], link[href*="/media/system/css/"]')) return 'joomla';
            } catch (_) { /* DOM access errors — return null below */ }
            return null;
        },

        getPresetHintDismissalsKey: function() { return 'uw-a11y-preset-hint-dismissals'; },

        loadPresetHintDismissals: function() {
            try {
                const raw = localStorage.getItem(this.getPresetHintDismissalsKey());
                if (!raw) return {};
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (_) { return {}; }
        },

        savePresetHintDismissals: function(map) {
            try { localStorage.setItem(this.getPresetHintDismissalsKey(), JSON.stringify(map || {})); } catch (_) {}
        },

        // Per-hostname dismissal: once a user dismisses the WordPress hint
        // on example.com, we don't surface it again on example.com. They
        // can still pick the preset manually in Settings.
        isPresetHintDismissed: function(presetKey) {
            const host = this.getCurrentHostname();
            if (!host || !presetKey) return false;
            const map = this.loadPresetHintDismissals();
            const entry = map[host];
            if (!entry) return false;
            // Dismissals stored as { hostname: ['wordpress', 'drupal'] } so
            // a wrong-detection dismissal on one platform doesn't suppress
            // the hint forever if detection ever swings to a different one.
            return Array.isArray(entry) ? entry.includes(presetKey) : entry === presetKey;
        },

        markPresetHintDismissed: function(presetKey) {
            const host = this.getCurrentHostname();
            if (!host || !presetKey) return;
            const map = this.loadPresetHintDismissals();
            const existing = map[host];
            const arr = Array.isArray(existing) ? existing.slice() : (existing ? [existing] : []);
            if (!arr.includes(presetKey)) arr.push(presetKey);
            map[host] = arr;
            this.savePresetHintDismissals(map);
        },

        // Should the results-view "Apply <Platform> preset?" hint render?
        // Returns the preset key to suggest, or null when nothing should
        // surface (no detection, preset already active, or user dismissed).
        getResultsPresetHintKey: function() {
            // Active preset → no nudge needed.
            if (this.getActivePresetForCurrentHost()) return null;
            const detected = this.detectPlatform();
            if (!detected) return null;
            if (!this.getPlatformPresets()[detected]) return null;
            if (this.isPresetHintDismissed(detected)) return null;
            return detected;
        },

        // Returns the parsed selectors contributed by the active preset for
        // the current hostname, factoring in the chosen Scan Mode. Returns
        // empty arrays when no preset is set.
        getActivePresetSelectors: function() {
            const entry = this.getActivePresetEntryForCurrentHost();
            if (!entry) return { scope: [], exclude: [] };
            const preset = this.getPlatformPresets()[entry.preset];
            const split = (s) => (s || '').split(',').map(v => v.trim()).filter(Boolean);
            const scope = split(preset.scope);
            if (entry.mode === 'content') {
                split(preset.contentScope).forEach(s => { if (!scope.includes(s)) scope.push(s); });
            }
            return { scope, exclude: split(preset.exclude) };
        },

        // ── Score history ─────────────────────────────────────────────────
        // Per-origin localStorage map: { "<pathname>": [ entry, entry, ... ] }
        // Each entry: { ts, score, counts: { errors, warnings, info, dismissed,
        // verified }, ruleIds: { errors:[], warnings:[], info:[] }, cfg: {
        // wcagSpec, wcagLevel, scoped } }. Capped to 100 entries per URL with
        // LRU eviction; identical adjacent scans within 5 minutes are coalesced
        // (last entry's `ts` updated) so re-running the same scan doesn't pad
        // the chart with duplicate points.
        getHistoryStorageKey: function() { return 'uw-a11y-history'; },
        getHistoryMaxEntries: function() { return 100; },

        // History tracking is opt-out — default on, controlled by settings.
        isHistoryTrackingEnabled: function() {
            const s = this.loadSettings();
            return s.trackHistory !== false;
        },

        setHistoryTrackingEnabled: function(enabled) {
            const s = this.loadSettings();
            s.trackHistory = !!enabled;
            this.saveSettings(s);
        },

        getCurrentHistoryBucketKey: function() {
            try {
                // Bucket by pathname (no query, no hash) — see CLAUDE notes.
                let path = location.pathname || '/';
                if (!path.startsWith('/')) path = '/' + path;
                return path;
            } catch (_) { return '/'; }
        },

        loadHistoryAll: function() {
            try {
                const raw = localStorage.getItem(this.getHistoryStorageKey());
                if (!raw) return {};
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                console.warn('[Pinpoint] history load failed:', e && e.message ? e.message : e);
                return {};
            }
        },

        saveHistoryAll: function(map) {
            try {
                localStorage.setItem(this.getHistoryStorageKey(), JSON.stringify(map || {}));
            } catch (e) {
                console.warn('[Pinpoint] history save failed (will attempt trim):', e && e.message ? e.message : e);
                // Quota exceeded — try a reduce-and-retry to keep newer entries.
                try {
                    const trimmed = {};
                    Object.keys(map || {}).forEach(k => {
                        const arr = Array.isArray(map[k]) ? map[k] : [];
                        trimmed[k] = arr.slice(-Math.max(10, Math.floor(this.getHistoryMaxEntries() / 4)));
                    });
                    localStorage.setItem(this.getHistoryStorageKey(), JSON.stringify(trimmed));
                } catch (e2) {
                    console.warn('[Pinpoint] history save failed even after trim — localStorage may be unavailable:', e2 && e2.message ? e2.message : e2);
                }
            }
        },

        // Console diagnostic for the bookmarklet vs. extension vs. test-page
        // mystery: dumps the storage state, what the checker thinks the
        // bucket key is, and a sample of recorded entries. Call from DevTools
        // as `uwAccessibilityChecker.historyDebug()`.
        historyDebug: function() {
            const out = {
                version: this.version,
                origin: location.origin,
                href: location.href,
                bucketKey: this.getCurrentHistoryBucketKey(),
                trackingEnabled: this.isHistoryTrackingEnabled(),
                localStorageAvailable: false,
                rawValue: null,
                parsed: null,
                forCurrentUrl: [],
                allKeysOnOrigin: []
            };
            try {
                const probeKey = '__pinpoint_probe__';
                localStorage.setItem(probeKey, '1');
                localStorage.removeItem(probeKey);
                out.localStorageAvailable = true;
                out.rawValue = localStorage.getItem(this.getHistoryStorageKey());
                out.allKeysOnOrigin = Object.keys(localStorage).filter(k => k.startsWith('uw-a11y-'));
            } catch (e) {
                out.localStorageError = e && e.message ? e.message : String(e);
            }
            try { out.parsed = out.rawValue ? JSON.parse(out.rawValue) : null; } catch (_) {}
            try { out.forCurrentUrl = this.getHistoryForCurrentUrl(); } catch (_) {}
            console.log('%c[Pinpoint] history diagnostic', 'color:#4f46e5;font-weight:bold');
            console.table({
                version: out.version,
                origin: out.origin,
                bucketKey: out.bucketKey,
                trackingEnabled: out.trackingEnabled,
                localStorageAvailable: out.localStorageAvailable,
                rawSizeBytes: out.rawValue ? out.rawValue.length : 0,
                bucketsStored: out.parsed ? Object.keys(out.parsed).length : 0,
                entriesForThisUrl: out.forCurrentUrl.length
            });
            console.log('Pinpoint keys on this origin:', out.allKeysOnOrigin);
            console.log('Full history map:', out.parsed);
            console.log('Entries for current URL:', out.forCurrentUrl);
            return out;
        },

        getHistoryForCurrentUrl: function() {
            const all = this.loadHistoryAll();
            const key = this.getCurrentHistoryBucketKey();
            return Array.isArray(all[key]) ? all[key] : [];
        },

        // Hash a config so we know whether two scans are comparable. Two
        // scans are only comparable when ALL of these match: WCAG version,
        // conformance level, whether scope is set, the platform preset, and
        // the scan mode (whole page / just content). Without preset+mode
        // here, WordPress whole-page and WordPress content-only would be
        // treated as the same kind of scan and produce misleading chart
        // swings when the user flips between them.
        cfgFingerprint: function(cfg) {
            if (!cfg) return '';
            return [
                cfg.wcagSpec || '',
                cfg.wcagLevel || '',
                cfg.scoped ? 's' : 'f',
                cfg.preset || '',
                cfg.mode || 'whole'
            ].join('|');
        },

        // Snapshot of the scan settings at the moment a scan runs. Used both
        // as the entry.cfg recorded into history AND as the current-cfg
        // baseline that filters the History view's chart to comparable
        // scans. Centralized here so the two paths can't drift.
        getCurrentScanCfg: function() {
            const wcag = this.getSelectedWcag ? this.getSelectedWcag() : { wcagSpec: '2.1', wcagLevel: 'AA' };
            return {
                wcagSpec: wcag.wcagSpec,
                wcagLevel: wcag.wcagLevel,
                scoped: this.getEffectiveIncludeSelectors().length > 0,
                preset: this.getActivePresetForCurrentHost() || '',
                mode: this.getActivePresetModeForCurrentHost() || 'whole'
            };
        },

        countsFingerprint: function(c) {
            if (!c) return '';
            return [c.errors|0, c.warnings|0, c.info|0, c.dismissed|0, c.verified|0].join(',');
        },

        // Record a scan's outcome for the current URL. Caller passes the score
        // object, the issue counts, the rule IDs that fired (split by severity),
        // and the cfg the scan ran under. Coalescing logic keeps repeated
        // identical re-scans from inflating the dataset.
        recordScanInHistory: function(score, counts, ruleIds, cfg) {
            if (!this.isHistoryTrackingEnabled()) return;
            if (typeof score !== 'number') return;

            const all = this.loadHistoryAll();
            const key = this.getCurrentHistoryBucketKey();
            const arr = Array.isArray(all[key]) ? all[key] : [];
            const now = Date.now();

            const entry = {
                ts: now,
                sessionId: this.sessionId || null,
                score: Math.round(score),
                counts: {
                    errors: (counts && counts.errors) | 0,
                    warnings: (counts && counts.warnings) | 0,
                    info: (counts && counts.info) | 0,
                    dismissed: (counts && counts.dismissed) | 0,
                    verified: (counts && counts.verified) | 0
                },
                ruleIds: {
                    errors: Array.isArray(ruleIds && ruleIds.errors) ? ruleIds.errors.slice(0, 50) : [],
                    warnings: Array.isArray(ruleIds && ruleIds.warnings) ? ruleIds.warnings.slice(0, 50) : [],
                    info: Array.isArray(ruleIds && ruleIds.info) ? ruleIds.info.slice(0, 50) : []
                },
                cfg: {
                    wcagSpec: (cfg && cfg.wcagSpec) || '2.1',
                    wcagLevel: (cfg && cfg.wcagLevel) || 'AA',
                    scoped: !!(cfg && cfg.scoped),
                    preset: (cfg && cfg.preset) || '',
                    mode: (cfg && cfg.mode) || 'whole'
                }
            };

            // Only coalesce within the SAME panel session — i.e. the user
            // re-scanned without reloading (e.g. via Save and Re-scan). A
            // fresh page load + bookmarklet click always gets a new
            // sessionId, so it always appends a new entry, even if the
            // results are identical to the previous run. This avoids the
            // "I scanned 5 times and only see 2 entries" trap caused by
            // time-window coalescing across reloads.
            const last = arr.length > 0 ? arr[arr.length - 1] : null;
            const sameSession = last && last.sessionId && entry.sessionId
                && last.sessionId === entry.sessionId;
            const sameCfg = last && this.cfgFingerprint(last.cfg) === this.cfgFingerprint(entry.cfg);
            const sameScore = last && last.score === entry.score;
            const sameCounts = last && this.countsFingerprint(last.counts) === this.countsFingerprint(entry.counts);

            if (sameSession && sameCfg && sameScore && sameCounts) {
                // Coalesce — same panel instance produced an identical re-run.
                last.ts = now;
            } else {
                arr.push(entry);
                // Cap to last N
                const max = this.getHistoryMaxEntries();
                if (arr.length > max) arr.splice(0, arr.length - max);
            }

            all[key] = arr;
            this.saveHistoryAll(all);
            // Refresh sparkline if it's mounted (results view visible)
            this.renderScoreHistorySparkline();
        },

        clearHistoryForCurrentUrl: function() {
            const all = this.loadHistoryAll();
            const key = this.getCurrentHistoryBucketKey();
            delete all[key];
            this.saveHistoryAll(all);
            this.renderHistoryView();
            this.renderScoreHistorySparkline();
        },

        clearAllHistory: function() {
            try { localStorage.removeItem(this.getHistoryStorageKey()); } catch (_) {}
            this.renderHistoryView();
            this.renderScoreHistorySparkline();
        },

        // Build the rule-id triple from the current `this.issues` array. Used
        // by the recording hook so the history can later show which rules
        // were introduced or resolved between scans.
        collectRuleIdsForHistory: function() {
            const out = { errors: new Set(), warnings: new Set(), info: new Set() };
            (this.issues || []).forEach(i => {
                if (!i || !i.ruleId) return;
                if (i.type === 'error') out.errors.add(i.ruleId);
                else if (i.type === 'warning') out.warnings.add(i.ruleId);
                else if (i.type === 'info') out.info.add(i.ruleId);
            });
            return {
                errors: [...out.errors],
                warnings: [...out.warnings],
                info: [...out.info]
            };
        },

        // Build the SVG path string for a score-over-time line. `entries` are
        // sorted oldest→newest. `width`/`height` are the inner drawing area;
        // padding leaves room for marker dots without clipping.
        buildHistoryLinePath: function(entries, width, height, pad) {
            if (!entries || entries.length === 0) return '';
            const padding = pad == null ? 4 : pad;
            const w = Math.max(10, width - padding * 2);
            const h = Math.max(10, height - padding * 2);
            const n = entries.length;
            const pts = entries.map((e, i) => {
                const x = padding + (n === 1 ? w / 2 : (i / (n - 1)) * w);
                const y = padding + (1 - (Math.max(0, Math.min(100, e.score)) / 100)) * h;
                return [x, y];
            });
            return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
        },

        // Compact sparkline beneath the score dial. ~140px wide. Hidden when
        // there are fewer than 2 entries (one dot wouldn't trend anything).
        // Only shows entries that match the current scan cfg, so flipping
        // (e.g.) WordPress whole-page ↔ just-the-content doesn't make the
        // line jump for reasons unrelated to the page changing.
        renderScoreHistorySparkline: function() {
            const host = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-score-sparkline');
            if (!host) return;
            const all = this.getHistoryForCurrentUrl();
            const fp = this.cfgFingerprint(this.getCurrentScanCfg());
            const entries = all.filter(e => this.cfgFingerprint(e.cfg) === fp);
            if (entries.length < 2) {
                host.innerHTML = '';
                host.style.display = 'none';
                return;
            }

            const recent = entries.slice(-20); // latest 20 scans (current cfg only)
            const w = 140, h = 32, pad = 3;
            const path = this.buildHistoryLinePath(recent, w, h, pad);
            const last = recent[recent.length - 1];
            const prev = recent[recent.length - 2];
            const delta = last.score - prev.score;
            const deltaSign = delta > 0 ? '+' : '';
            const deltaColor = delta > 0 ? '#198754' : delta < 0 ? '#b22222' : '#666';

            // Endpoint dot for emphasis
            const lastX = pad + ((recent.length - 1) / Math.max(1, recent.length - 1)) * (w - pad * 2);
            const lastY = pad + (1 - (last.score / 100)) * (h - pad * 2);

            host.style.display = '';
            host.innerHTML = `
                <a href="#uw-a11y-view-history" class="uw-a11y-spark-link" aria-label="Open score history (${recent.length} scans)">
                    <svg class="uw-a11y-spark-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
                        <path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
                        <circle cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="2.5" fill="currentColor"/>
                    </svg>
                    <span class="uw-a11y-spark-meta">
                        <span class="uw-a11y-spark-delta" style="color:${deltaColor}">${deltaSign}${delta} vs. last</span>
                        <span class="uw-a11y-spark-count">· ${recent.length} scan${recent.length === 1 ? '' : 's'}</span>
                    </span>
                </a>
            `;
            const link = host.querySelector('.uw-a11y-spark-link');
            if (link) {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showView('history');
                });
            }
        },

        // ── History view ──────────────────────────────────────────────────
        // Full view: line chart, stacked bar of issue counts over time, deltas
        // vs. previous scan, and lists of rules introduced/resolved.
        renderHistoryView: function() {
            const wrap = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-view-history');
            if (!wrap) return;
            const inner = wrap.querySelector('.uw-a11y-history') || wrap;

            const enabled = this.isHistoryTrackingEnabled();
            const bucketKey = this.getCurrentHistoryBucketKey();
            const entries = this.getHistoryForCurrentUrl();
            const allCount = Object.values(this.loadHistoryAll())
                .reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);

            // Empty / disabled states
            if (!enabled) {
                inner.innerHTML = `
                    <div class="uw-a11y-history-wrap">
                        <h3>Score history</h3>
                        <p class="uw-a11y-helptext">History tracking is currently <strong>disabled</strong>. Enable it in <a href="#" class="uw-a11y-link-btn" data-go-settings>Settings → History</a> to start recording scans for this URL.</p>
                    </div>
                `;
                const goLink = inner.querySelector('[data-go-settings]');
                if (goLink) goLink.addEventListener('click', (e) => { e.preventDefault(); this.showView('settings'); });
                return;
            }

            if (entries.length === 0) {
                inner.innerHTML = `
                    <div class="uw-a11y-history-wrap">
                        <h3>Score history</h3>
                        <p class="uw-a11y-helptext">No scans recorded yet for this URL (<code>${this.escapeHtmlContent(bucketKey)}</code>). Run a scan and the result will be saved here so you can compare it with future runs.</p>
                        ${allCount > 0 ? `<p class="uw-a11y-helptext">${allCount} scan${allCount === 1 ? '' : 's'} are recorded for other paths on this site.</p>` : ''}
                    </div>
                `;
                return;
            }

            const fmtDate = (ts) => {
                try {
                    const d = new Date(ts);
                    const today = new Date();
                    const sameDay = d.toDateString() === today.toDateString();
                    return sameDay
                        ? `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                        : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                } catch (_) { return ''; }
            };

            // Filter to entries that match the CURRENT scan settings by
            // default — flipping WordPress whole-page ↔ just-the-content (or
            // changing WCAG level) shouldn't make the chart appear to
            // fluctuate. The user can toggle to "show all" via the chevron
            // button to see every recorded scan with hollow dots marking the
            // ones that used a different cfg.
            const currentFp = this.cfgFingerprint(this.getCurrentScanCfg());
            const showAll = !!this.historyShowAll;
            const filtered = showAll ? entries : entries.filter(e => this.cfgFingerprint(e.cfg) === currentFp);
            const hiddenCount = entries.length - filtered.length;

            // Use the most recent same-cfg entry as "last", and the one
            // before it as "prev", so deltas are apples-to-apples even when
            // the absolute most-recent entry was recorded under a different
            // cfg (e.g. user just flipped to a new mode for the first time).
            const compareEntries = showAll ? entries : filtered;
            const last = compareEntries.length > 0 ? compareEntries[compareEntries.length - 1]
                : entries[entries.length - 1];
            const prev = compareEntries.length >= 2 ? compareEntries[compareEntries.length - 2] : null;

            // Empty-after-filter state: there are entries on disk but none
            // of them used the current cfg. Show numbers from the most
            // recent entry (already assigned to `last`) but skip the chart.
            const filteredEmpty = !showAll && filtered.length === 0;

            // Chart geometry
            const cw = 420, ch = 140, pad = 18;
            const chartEntries = filtered.slice(-30); // last 30 (filtered)
            const linePath = this.buildHistoryLinePath(chartEntries, cw, ch, pad);
            const innerW = cw - pad * 2;
            const innerH = ch - pad * 2;
            // Y axis labels (0 / 50 / 100)
            const yLabels = [100, 75, 50, 25, 0].map(v => {
                const y = pad + (1 - v / 100) * innerH;
                return `<line x1="${pad}" x2="${cw - pad}" y1="${y}" y2="${y}" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>
                        <text x="${pad - 4}" y="${y + 3}" text-anchor="end" font-size="9" fill="#888">${v}</text>`;
            }).join('');
            // Cfg label for tooltip — describes the scan settings on the dot.
            const cfgLabelFor = (cfg) => {
                if (!cfg) return '';
                const parts = [`${cfg.wcagSpec || ''} ${cfg.wcagLevel || ''}`.trim()];
                if (cfg.preset) {
                    const presets = this.getPlatformPresets();
                    const lbl = presets[cfg.preset] ? presets[cfg.preset].label : cfg.preset;
                    parts.push(`${lbl}${cfg.mode === 'content' ? ' · just the content' : ''}`);
                } else if (cfg.scoped) {
                    parts.push('scoped');
                }
                return parts.filter(Boolean).join(' · ');
            };
            // Dots — filled when cfg matches the current settings; hollow
            // when it doesn't (only relevant in "show all" mode since the
            // filtered view excludes mismatches entirely).
            const dots = chartEntries.map((e, i) => {
                const x = pad + (chartEntries.length === 1 ? innerW / 2 : (i / (chartEntries.length - 1)) * innerW);
                const y = pad + (1 - (Math.max(0, Math.min(100, e.score)) / 100)) * innerH;
                const sameCfg = this.cfgFingerprint(e.cfg) === currentFp;
                const fill = sameCfg ? 'currentColor' : '#fff';
                const stroke = sameCfg ? 'none' : 'currentColor';
                return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3" fill="${fill}" stroke="${stroke}" stroke-width="1.5"><title>${this.escapeHtmlAttribute(fmtDate(e.ts))} · score ${e.score} · ${cfgLabelFor(e.cfg)}</title></circle>`;
            }).join('');

            // Stacked bar of error/warning/info counts, normalized so a busy
            // scan doesn't wash out a quieter one — bars are scaled to the
            // worst (largest sum) scan in this window.
            const maxSum = Math.max(1, ...chartEntries.map(e => (e.counts.errors|0) + (e.counts.warnings|0) + (e.counts.info|0)));
            const barW = Math.max(4, Math.min(14, Math.floor(innerW / chartEntries.length) - 2));
            const bars = chartEntries.map((e, i) => {
                const x = pad + (chartEntries.length === 1 ? innerW / 2 - barW / 2 : (i / (chartEntries.length - 1)) * innerW - barW / 2);
                const total = (e.counts.errors|0) + (e.counts.warnings|0) + (e.counts.info|0);
                const totalH = (total / maxSum) * 60;
                let yCursor = 80 - totalH; // baseline at y=80, bars grow upward
                const errH = (e.counts.errors / maxSum) * 60;
                const warnH = (e.counts.warnings / maxSum) * 60;
                const infoH = (e.counts.info / maxSum) * 60;
                let segs = '';
                if (errH > 0)  { segs += `<rect x="${x.toFixed(2)}" y="${yCursor.toFixed(2)}" width="${barW}" height="${errH.toFixed(2)}" fill="#dc3545"/>`; yCursor += errH; }
                if (warnH > 0) { segs += `<rect x="${x.toFixed(2)}" y="${yCursor.toFixed(2)}" width="${barW}" height="${warnH.toFixed(2)}" fill="#f0ad4e"/>`; yCursor += warnH; }
                if (infoH > 0) { segs += `<rect x="${x.toFixed(2)}" y="${yCursor.toFixed(2)}" width="${barW}" height="${infoH.toFixed(2)}" fill="#0d6efd"/>`; }
                return `<g><title>${this.escapeHtmlAttribute(fmtDate(e.ts))} · ${e.counts.errors|0} err / ${e.counts.warnings|0} review / ${e.counts.info|0} info</title>${segs}</g>`;
            }).join('');

            // Latest-scan summary cards. Each card shows the CURRENT value
            // (large) and, when a prior scan exists, the change vs. that
            // prior scan as a small coloured badge. Skipped entirely when
            // there's no `last` to read from (filtered-empty case).
            const currScore = last ? (last.score | 0) : 0;
            const currErr   = last ? (last.counts.errors | 0) : 0;
            const currWarn  = last ? (last.counts.warnings | 0) : 0;
            const currInfo  = last ? (last.counts.info | 0) : 0;

            const deltaBadge = (curr, prevVal, goodWhenNegative) => {
                if (prev == null) return '';
                if (typeof prevVal !== 'number') return '';
                const d = curr - prevVal;
                let cls = 'is-flat';
                let label = 'no change';
                if (d !== 0) {
                    const isGood = goodWhenNegative ? d < 0 : d > 0;
                    cls = isGood ? 'is-good' : 'is-bad';
                    label = (d > 0 ? '+' : '') + d;
                }
                return `<span class="uw-a11y-history-delta-badge ${cls}">${this.escapeHtmlContent(label)}</span>`;
            };

            // Cfg-mismatch warnings:
            //   • In show-all mode: warn when the most recent two entries
            //     used different settings (the original behavior).
            //   • In filtered mode: warn when the absolute-most-recent entry
            //     uses a different cfg than what's filtered to (i.e. the
            //     user just changed settings and the latest scan hasn't
            //     run yet under the new cfg).
            let cfgWarn = '';
            const absoluteLast = entries[entries.length - 1];
            if (showAll && prev && this.cfgFingerprint(last.cfg) !== this.cfgFingerprint(prev.cfg)) {
                cfgWarn = `<p class="uw-a11y-history-cfg-warn">⚠ Last two scans used different settings — comparison may be misleading.</p>`;
            } else if (!showAll && absoluteLast && this.cfgFingerprint(absoluteLast.cfg) !== currentFp) {
                cfgWarn = `<p class="uw-a11y-history-cfg-warn">⚠ The most recent scan used different settings than the current ones. Re-run a scan to add a comparable point.</p>`;
            }

            const summaryHeading = prev
                ? `<h4 class="uw-a11y-history-summary-heading">Latest scan <span class="uw-a11y-history-summary-sub">vs. previous</span></h4>`
                : `<h4 class="uw-a11y-history-summary-heading">Latest scan</h4>`;

            const deltaHtml = (filteredEmpty || !last) ? '' : `
                ${summaryHeading}
                <div class="uw-a11y-history-deltas" role="group" aria-label="Latest scan summary${prev ? ' with change since previous scan' : ''}">
                    <div class="uw-a11y-history-delta">
                        <strong>${currScore}</strong>
                        <span>score</span>
                        ${deltaBadge(currScore, prev && prev.score, false)}
                    </div>
                    <div class="uw-a11y-history-delta">
                        <strong>${currErr}</strong>
                        <span>violations</span>
                        ${deltaBadge(currErr, prev && (prev.counts.errors|0), true)}
                    </div>
                    <div class="uw-a11y-history-delta">
                        <strong>${currWarn}</strong>
                        <span>manual review</span>
                        ${deltaBadge(currWarn, prev && (prev.counts.warnings|0), true)}
                    </div>
                    <div class="uw-a11y-history-delta">
                        <strong>${currInfo}</strong>
                        <span>best practices</span>
                        ${deltaBadge(currInfo, prev && (prev.counts.info|0), true)}
                    </div>
                </div>
                ${cfgWarn}
            `;

            // Rules introduced / resolved between last two same-cfg scans
            let rulesHtml = '';
            if (last && prev) {
                const lastAll = new Set([...(last.ruleIds.errors||[]), ...(last.ruleIds.warnings||[]), ...(last.ruleIds.info||[])]);
                const prevAll = new Set([...(prev.ruleIds.errors||[]), ...(prev.ruleIds.warnings||[]), ...(prev.ruleIds.info||[])]);
                const introduced = [...lastAll].filter(r => !prevAll.has(r));
                const resolved = [...prevAll].filter(r => !lastAll.has(r));
                const ruleLine = (arr, kind) => arr.length === 0
                    ? `<li class="uw-a11y-history-rule-empty">None</li>`
                    : arr.slice(0, 12).map(r => `<li><code>${this.escapeHtmlContent(r)}</code></li>`).join('') +
                      (arr.length > 12 ? `<li class="uw-a11y-history-rule-empty">…and ${arr.length - 12} more</li>` : '');
                rulesHtml = `
                    <div class="uw-a11y-history-rules">
                        <div>
                            <h4>Newly introduced</h4>
                            <ul>${ruleLine(introduced, 'new')}</ul>
                        </div>
                        <div>
                            <h4>Resolved since last scan</h4>
                            <ul>${ruleLine(resolved, 'gone')}</ul>
                        </div>
                    </div>
                `;
            }

            // Describe the active filter for the bucket header.
            const presetEntry = this.getActivePresetEntryForCurrentHost();
            const presets = this.getPlatformPresets();
            const filterDesc = (() => {
                if (showAll) return 'All scan settings';
                const wcag = this.getSelectedWcag ? this.getSelectedWcag() : { wcagSpec: '2.1', wcagLevel: 'AA' };
                const parts = [`${wcag.wcagSpec || ''} ${wcag.wcagLevel || ''}`.trim()];
                if (presetEntry) {
                    const lbl = presets[presetEntry.preset] ? presets[presetEntry.preset].label : presetEntry.preset;
                    parts.push(`${lbl}${presetEntry.mode === 'content' ? ' · just the content' : ''}`);
                } else if (this.getEffectiveIncludeSelectors().length > 0) {
                    parts.push('scoped');
                }
                return parts.filter(Boolean).join(' · ');
            })();

            const filteredEmptyMsg = filteredEmpty ? `
                <div class="uw-a11y-history-empty-filter">
                    <p>No prior scans recorded under the current settings (<strong>${this.escapeHtmlContent(filterDesc)}</strong>) for this URL. Re-run a scan and it will appear here, or switch to <strong>Show all scans</strong> below to view scans recorded under different settings.</p>
                </div>
            ` : '';

            const chartBlocks = filteredEmpty ? '' : `
                <div class="uw-a11y-history-chart" role="img" aria-label="Accessibility score over the last ${chartEntries.length} scans">
                    <svg viewBox="0 0 ${cw} ${ch}" width="100%" height="${ch}" preserveAspectRatio="none" style="color:#4f46e5;">
                        ${yLabels}
                        <path d="${linePath}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
                        ${dots}
                    </svg>
                </div>

                <div class="uw-a11y-history-bars" role="img" aria-label="Issue counts (errors, manual review, best practices) over time">
                    <svg viewBox="0 0 ${cw} 90" width="100%" height="90" preserveAspectRatio="none">
                        <line x1="${pad}" x2="${cw - pad}" y1="80" y2="80" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>
                        ${bars}
                    </svg>
                    <div class="uw-a11y-history-legend">
                        <span><i style="background:#dc3545"></i>Violations</span>
                        <span><i style="background:#f0ad4e"></i>Manual review</span>
                        <span><i style="background:#0d6efd"></i>Best practices</span>
                    </div>
                </div>
            `;

            inner.innerHTML = `
                <div class="uw-a11y-history-wrap">
                    <h3>Score history</h3>
                    <p class="uw-a11y-history-bucket">
                        Tracking <code>${this.escapeHtmlContent(bucketKey)}</code> ·
                        ${showAll
                            ? `${entries.length} total scan${entries.length === 1 ? '' : 's'}`
                            : `${filtered.length}/${entries.length} scan${entries.length === 1 ? '' : 's'} match current settings`}
                        ${last ? ` · latest ${fmtDate(last.ts)}` : ''}
                    </p>
                    <div class="uw-a11y-history-filter-row">
                        <span class="uw-a11y-history-filter-label">${showAll ? 'Showing: <strong>all scan settings</strong>' : `Showing: <strong>${this.escapeHtmlContent(filterDesc)}</strong>`}</span>
                        ${(hiddenCount > 0 || showAll)
                            ? `<button type="button" class="uw-a11y-link-btn" id="uw-a11y-history-toggle-show">${showAll ? `Show only current settings` : `Show all scans (${hiddenCount} hidden)`}</button>`
                            : ''}
                    </div>

                    ${filteredEmptyMsg}
                    ${chartBlocks}

                    ${deltaHtml}
                    ${rulesHtml}

                    <div class="uw-a11y-history-actions">
                        <button type="button" class="uw-a11y-btn uw-a11y-btn-secondary" id="uw-a11y-history-clear-url">Clear history for this URL</button>
                        <button type="button" class="uw-a11y-btn uw-a11y-btn-secondary" id="uw-a11y-history-clear-all">Clear all history</button>
                    </div>
                    <p class="uw-a11y-helptext">History is stored locally in this browser only. Different browsers, devices, or private windows have separate histories.</p>
                </div>
            `;

            const toggleShow = inner.querySelector('#uw-a11y-history-toggle-show');
            if (toggleShow) {
                toggleShow.addEventListener('click', () => {
                    this.historyShowAll = !this.historyShowAll;
                    this.playSound('ui');
                    this.renderHistoryView();
                });
            }

            const clearUrlBtn = inner.querySelector('#uw-a11y-history-clear-url');
            const clearAllBtn = inner.querySelector('#uw-a11y-history-clear-all');
            // Two-step confirm pattern reused from dismiss
            const armConfirm = (btn, label, action) => {
                if (!btn) return;
                btn.addEventListener('click', () => {
                    if (btn.dataset.confirming) {
                        delete btn.dataset.confirming;
                        action();
                        return;
                    }
                    btn.dataset.confirming = '1';
                    const orig = btn.textContent;
                    btn.textContent = `Click again to confirm`;
                    btn.classList.add('uw-a11y-dismiss-btn--confirming');
                    setTimeout(() => {
                        if (btn.isConnected) {
                            delete btn.dataset.confirming;
                            btn.textContent = orig;
                            btn.classList.remove('uw-a11y-dismiss-btn--confirming');
                        }
                    }, 4000);
                });
            };
            armConfirm(clearUrlBtn, 'Clear history for this URL', () => this.clearHistoryForCurrentUrl());
            armConfirm(clearAllBtn, 'Clear all history', () => this.clearAllHistory());
        },

        // Walk the saved include selectors. For each [data-pinpoint-scope="pp-N"]
        // entry, try to re-stamp the attribute onto the element matched by the
        // stored structural fallback. Drop entries that can't be rehydrated.
        // Bumps _pickerScopeSeq so newly-picked scopes don't collide with
        // existing IDs from a previous session.
        rehydratePickerScopes: function() {
            const s = this.loadSettings();
            const includes = Array.isArray(s.includeSelectors)
                ? s.includeSelectors
                : (typeof s.includeSelectors === 'string'
                    ? s.includeSelectors.split(',').map(v => v.trim()).filter(Boolean)
                    : []);
            if (includes.length === 0) return;

            const fallbacks = this.getPickerScopeFallbacks();
            const survivors = [];
            const survivingFallbacks = {};
            let highestSeq = this._pickerScopeSeq || 0;
            let mutated = false;

            includes.forEach(sel => {
                const m = sel.match(/^\[data-pinpoint-scope="(pp-(\d+))"\]$/);
                if (!m) {
                    // Non-picker selector — keep as-is.
                    survivors.push(sel);
                    return;
                }
                const scopeId = m[1];
                const seqNum = parseInt(m[2], 10);
                if (!isNaN(seqNum) && seqNum > highestSeq) highestSeq = seqNum;

                // Already on the page from this session? Keep.
                if (document.querySelector(sel)) {
                    survivors.push(sel);
                    if (fallbacks[scopeId]) survivingFallbacks[scopeId] = fallbacks[scopeId];
                    return;
                }

                // Try to re-stamp via the structural fallback.
                const fallback = fallbacks[scopeId];
                if (fallback) {
                    try {
                        const el = document.querySelector(fallback);
                        if (el) {
                            el.setAttribute('data-pinpoint-scope', scopeId);
                            survivors.push(sel);
                            survivingFallbacks[scopeId] = fallback;
                            return;
                        }
                    } catch (_) { /* invalid selector — fall through to drop */ }
                }

                // Couldn't rehydrate — drop this scope entry.
                mutated = true;
            });

            this._pickerScopeSeq = highestSeq;

            if (mutated) {
                s.includeSelectors = survivors;
                this.saveSettings(s);
                this.savePickerScopeFallbacks(survivingFallbacks);
            } else if (Object.keys(survivingFallbacks).length !== Object.keys(fallbacks).length) {
                this.savePickerScopeFallbacks(survivingFallbacks);
            }
        },

        // Whether best-practice suggestions are enabled (default: true)
        isBestPracticesEnabled: function() {
            const s = this.loadSettings();
            return s.enableBestPractices !== false; // default true unless explicitly false
        },

        // Combine user excludes with enforced internal ones AND any selectors
        // contributed by the active platform preset for the current hostname.
        getEffectiveExcludeSelectors: function() {
            const essentials = this.getEssentialExcludeSelectors();
            const defaults = this.getDefaultExcludeSelectors();
            const s = this.loadSettings();
            const user = Array.isArray(s.excludeSelectors) ? s.excludeSelectors : (typeof s.excludeSelectors === 'string' ? s.excludeSelectors.split(',') : []);
            const clean = (user || [])
                .map(v => (v || '').toString().trim())
                .filter(Boolean);
            const presetExclude = this.getActivePresetSelectors().exclude;
            // Merge in order: essentials (always), defaults, user additions, preset additions
            return [...new Set([ ...essentials, ...defaults, ...clean, ...presetExclude ])];
        },

        // Return effective include selectors (elements to restrict scan to).
        // Combines user-typed scope with any scope contributed by the active
        // platform preset for the current hostname.
        getEffectiveIncludeSelectors: function() {
            const s = this.loadSettings();
            const user = Array.isArray(s.includeSelectors) ? s.includeSelectors
                : (typeof s.includeSelectors === 'string' ? s.includeSelectors.split(',') : []);
            const userClean = user.map(v => (v || '').toString().trim()).filter(Boolean);
            const presetScope = this.getActivePresetSelectors().scope;
            return [...new Set([ ...userClean, ...presetScope ])];
        },

        // Build axe-core context object (excludes only; include-scope is applied
        // in processAxeResults by checking element containment, which is more reliable
        // than axe-core's include context which can be silently ignored for document-level rules)
        buildAxeContext: function() {
            return { exclude: this.getEffectiveExcludeSelectors() };
        },

        // Human-readable label for the scope banner — translates data-pinpoint-scope
        // attribute selectors back into tag+id+class descriptions. Returns only
        // the user-typed (manual) selectors; preset contributions are surfaced
        // separately via getScopeBannerHtml so the banner can be worded
        // differently when scope is preset-driven.
        getScopeDisplayLabel: function() {
            const formatSelector = (sel) => {
                const attrMatch = sel.match(/^\[data-pinpoint-scope="([^"]+)"\]$/);
                if (attrMatch) {
                    try {
                        const el = document.querySelector(sel);
                        if (el) return this.getPickerBadgeText(el);
                    } catch(_) {}
                }
                return sel;
            };
            const s = this.loadSettings();
            const manual = Array.isArray(s.includeSelectors) ? s.includeSelectors
                : (typeof s.includeSelectors === 'string' ? s.includeSelectors.split(',') : []);
            return manual
                .map(v => (v || '').toString().trim())
                .filter(Boolean)
                .map(formatSelector)
                .join(', ');
        },

        // Builds the inner HTML of the active-preset / scope banner. Wording
        // varies by what's actually shaping the scan:
        //   • manual selectors only          → "Partial scan — scoped to: <selectors>"
        //   • preset that contributes scope  → "Partial scan — <Preset> preset[ · just the content]"
        //   • preset, excludes only          → "<Preset> preset — site chrome excluded"
        //   • mixed manual + preset          → both surfaced
        // Returns empty string when there is no preset and no manual scope.
        getScopeBannerHtml: function() {
            const hasScope = this.getEffectiveIncludeSelectors().length > 0;
            const presetEntry = this.getActivePresetEntryForCurrentHost();
            if (!hasScope && !presetEntry) return '';

            const manualLabel = this.getScopeDisplayLabel();
            const presets = this.getPlatformPresets();
            const preset = presetEntry ? presets[presetEntry.preset] : null;
            const presetScopeContributes = preset && this.getActivePresetSelectors().scope.length > 0;
            const codeStyle = 'font-size:11px;';
            const modeSuffix = (presetEntry && presetEntry.mode === 'content') ? ' · just the content' : '';

            // Mixed: manual selectors AND preset scope
            if (manualLabel && presetScopeContributes) {
                return `<strong>Partial scan</strong> — scoped to: <code style="${codeStyle}">${this.escapeHtmlContent(manualLabel)}</code> · <strong>${this.escapeHtmlContent(preset.label)}</strong> preset${modeSuffix}`;
            }
            // Preset that scopes (e.g. LibGuides, or any preset in "just the content" mode)
            if (presetScopeContributes) {
                return `<strong>Partial scan</strong> — <strong>${this.escapeHtmlContent(preset.label)}</strong> preset${modeSuffix}`;
            }
            // Preset that only excludes (e.g. WordPress in whole-page mode)
            if (preset) {
                if (manualLabel) {
                    return `<strong>Partial scan</strong> — scoped to: <code style="${codeStyle}">${this.escapeHtmlContent(manualLabel)}</code> · <strong>${this.escapeHtmlContent(preset.label)}</strong> preset`;
                }
                return `<strong>${this.escapeHtmlContent(preset.label)}</strong> preset — site chrome excluded`;
            }
            // Manual scope only
            return `<strong>Partial scan</strong> — scoped to: <code style="${codeStyle}">${this.escapeHtmlContent(manualLabel)}</code>`;
        },

        // Returns a function that tests whether a DOM element is within the current scan scope.
        // If no include selectors are set, every element is in scope.
        buildScopeFilter: function() {
            const includes = this.getEffectiveIncludeSelectors();
            if (includes.length === 0) return () => true;
            const roots = includes.flatMap(sel => {
                try { return Array.from(document.querySelectorAll(sel)); } catch(_) { return []; }
            });
            if (roots.length === 0) return () => true; // selector matched nothing — don't hide everything
            return (el) => {
                if (!el) return true; // unknown element — include conservatively
                return roots.some(root => root === el || root.contains(el));
            };
        },

        // Check if an element should be excluded by settings
        shouldExcludeElement: function(el) {
            try {
                const selectors = this.getEffectiveExcludeSelectors();
                for (const sel of selectors) {
                    if (!sel) continue;
                    try {
                        if (el.matches(sel)) return true;
                        if (el.closest && el.closest(sel)) return true;
                    } catch (_) { /* invalid selector safety */ }
                }
            } catch (_) { /* ignore */ }
            return false;
        },

        // WCAG selection helpers
        getDefaultWcag: function() { return { wcagSpec: '2.1', wcagLevel: 'AA' }; },
        getSelectedWcag: function() {
            const s = this.loadSettings();
            const d = this.getDefaultWcag();
            return { wcagSpec: s.wcagSpec || d.wcagSpec, wcagLevel: s.wcagLevel || d.wcagLevel };
        },
        buildWcagTags: function(spec, level) {
            const lvl = (level || 'AA').toUpperCase();
            const levelKey = lvl.toLowerCase(); // 'a' | 'aa' | 'aaa'
            const specs = ['2.0','2.1','2.2'];
            const chosenIdx = Math.max(0, specs.indexOf(spec || '2.1'));
            const tags = [];
            for (let i = 0; i <= chosenIdx; i++) {
                const s = specs[i].replace('.', ''); // '20','21','22'
                const prefix = i === 0 ? 'wcag2' : `wcag${s}`;
                tags.push(`${prefix}${levelKey}`);
            }
            // Also include lower levels implicitly when AA/AAA chosen
            if (lvl === 'AA' || lvl === 'AAA') {
                for (let i = 0; i <= chosenIdx; i++) {
                    const s = specs[i].replace('.', '');
                    const prefix = i === 0 ? 'wcag2' : `wcag${s}`;
                    if (!tags.includes(`${prefix}a`)) tags.push(`${prefix}a`);
                }
            }
            if (lvl === 'AAA') {
                for (let i = 0; i <= chosenIdx; i++) {
                    const s = specs[i].replace('.', '');
                    const prefix = i === 0 ? 'wcag2' : `wcag${s}`;
                    if (!tags.includes(`${prefix}aa`)) tags.push(`${prefix}aa`);
                }
            }
            return tags;
        },

        getWcagLabel: function() {
            const { wcagSpec, wcagLevel } = this.getSelectedWcag();
            return `WCAG ${wcagSpec} ${String(wcagLevel || '').toUpperCase()}`;
        },

        // Inspector hub ↔ detail (heavy tools open on a second screen within the Inspector view)
        _applyInspectorHubLayout: function() {
            this.inspectorSubView = null;
            const root = this.shadowRoot;
            if (!root) return;
            const hub = root.getElementById('uw-a11y-inspector-hub');
            const detail = root.getElementById('uw-a11y-inspector-detail');
            if (hub) hub.removeAttribute('hidden');
            if (detail) detail.setAttribute('hidden', '');
            ['outline', 'links', 'cvd', 'alt', 'contrast'].forEach((id) => {
                const p = root.getElementById('uw-a11y-inspector-panel-' + id);
                if (p) p.setAttribute('hidden', '');
            });
            const h = root.getElementById('uw-a11y-inspector-detail-heading');
            if (h) h.textContent = '';
        },

        resetInspectorToHub: function() {
            this._inspectorReturnFocusEl = null;
            this._applyInspectorHubLayout();
            this.syncInspectorHubStatus();
        },

        // Turn on list-style tools when entering a detail panel so users see content immediately.
        _autoActivateInspectorDetailPanel: function(panelId) {
            if (panelId === 'outline' && !this.isOutlineViewActive) {
                this.toggleOutlineView();
            } else if (panelId === 'links' && !this.isLinksViewActive) {
                this.toggleLinksView();
            } else if (panelId === 'alt' && !this.isAltTextListActive) {
                this.toggleAltTextList();
            }
        },

        // Public entry points for inline-action buttons inside recommendations.
        // Each button switches to the Inspector and opens the relevant tool
        // (outline, links, alt, cvd, contrast), or toggles an on-page overlay
        // (landmarks, tabOrder, focusIndicators). See formatRecommendation()
        // for the sentinel patterns that produce these buttons.
        openContrastChecker: function(node) {
            try {
                this.showView('inspector');
                this.openInspectorDetail('contrast');
                if (node) this.prefillContrastFromNode(node);
            } catch (e) {
                console.warn('[Pinpoint] openContrastChecker failed:', e && e.message);
            }
        },

        openInspectorTool: function(name) {
            try {
                const valid = { outline: 1, links: 1, cvd: 1, alt: 1, contrast: 1 };
                if (!valid[name]) return;
                this.showView('inspector');
                this.openInspectorDetail(name);
            } catch (e) {
                console.warn('[Pinpoint] openInspectorTool failed:', e && e.message);
            }
        },

        toggleVisualization: function(name) {
            try {
                if (name === 'landmarks' && typeof this.toggleLandmarkStructureVisualization === 'function') {
                    this.toggleLandmarkStructureVisualization();
                } else if (name === 'tabOrder' && typeof this.toggleTabOrderVisualization === 'function') {
                    this.toggleTabOrderVisualization();
                } else if (name === 'focusIndicators' && typeof this.toggleFocusIndicatorsVisualization === 'function') {
                    this.toggleFocusIndicatorsVisualization();
                }
            } catch (e) {
                console.warn('[Pinpoint] toggleVisualization failed:', e && e.message);
            }
        },

        prefillContrastFromNode: function(node) {
            try {
                if (!node) return;
                const el = (node.nodeType === 1) ? node : this.getElementFromNode(node);
                if (!el) return;
                const cs = window.getComputedStyle(el);
                const fg = this.rgbStringToHex(cs.color);
                if (!fg) return;
                this.contrastCheckerState = this.contrastCheckerState || { fg: '#000000', bg: '#ffffff', ratio: null };
                this.contrastCheckerState.fg = fg;
                const root = this.shadowRoot;
                if (!root) return;
                const fgInput = root.getElementById('uw-a11y-contrast-hex-fg');
                const fgColor = root.getElementById('uw-a11y-contrast-color-fg');
                if (fgInput) fgInput.value = fg.toUpperCase();
                if (fgColor) fgColor.value = fg.toLowerCase();
                if (typeof this.recomputeContrastResult === 'function') this.recomputeContrastResult();
            } catch (_) { /* best-effort */ }
        },

        rgbStringToHex: function(rgb) {
            if (!rgb) return '';
            const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
            if (!m) return '';
            const toHex = n => Number(n).toString(16).padStart(2, '0');
            return '#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
        },

        openInspectorDetail: function(panelId) {
            const titles = {
                outline: 'Page outline',
                links: 'Links',
                cvd: 'Color blindness simulation',
                alt: 'Alternative text',
                contrast: 'Contrast checker'
            };
            if (!titles[panelId]) return;
            const root = this.shadowRoot;
            if (!root) return;

            this._inspectorReturnFocusEl = document.activeElement;

            const hub = root.getElementById('uw-a11y-inspector-hub');
            const detail = root.getElementById('uw-a11y-inspector-detail');
            if (hub) hub.setAttribute('hidden', '');
            if (detail) detail.removeAttribute('hidden');

            ['outline', 'links', 'cvd', 'alt', 'contrast'].forEach((id) => {
                const p = root.getElementById('uw-a11y-inspector-panel-' + id);
                if (p) {
                    if (id === panelId) p.removeAttribute('hidden');
                    else p.setAttribute('hidden', '');
                }
            });

            const heading = root.getElementById('uw-a11y-inspector-detail-heading');
            if (heading) heading.textContent = titles[panelId];

            this.inspectorSubView = panelId;
            this._autoActivateInspectorDetailPanel(panelId);
            this.syncInspectorHubStatus();
            this.syncInspectorContentHeight();

            const back = root.getElementById('uw-a11y-inspector-back');
            if (back) {
                requestAnimationFrame(() => {
                    try { back.focus(); } catch (_) {}
                });
            }
        },

        closeInspectorDetail: function() {
            const ret = this._inspectorReturnFocusEl;
            this._inspectorReturnFocusEl = null;
            this._applyInspectorHubLayout();
            this.syncInspectorHubStatus();
            this.syncInspectorContentHeight();
            requestAnimationFrame(() => {
                if (ret && ret.isConnected) {
                    try { ret.focus(); } catch (_) {}
                }
            });
        },

        syncInspectorContentHeight: function() {
            if (this.currentView !== 'inspector') return;
            const content = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-content');
            if (!content) return;
            const maxAllowedHeight = this.getMaxContentHeight();
            const idealHeight = this.measureViewHeight('inspector');
            if (idealHeight == null) return;
            const newHeight = Math.min(idealHeight, maxAllowedHeight);
            content.style.maxHeight = maxAllowedHeight + 'px';
            if (this.isAnimating) {
                content.style.height = newHeight + 'px';
            } else if (window.gsap && !this.prefersReducedMotion()) {
                window.gsap.killTweensOf(content);
                window.gsap.to(content, {
                    height: newHeight,
                    duration: 0.3,
                    ease: 'power2.out'
                });
            } else {
                content.style.height = newHeight + 'px';
            }
            content.style.overflowY = 'auto';
        },

        syncInspectorHubStatus: function() {
            const root = this.shadowRoot;
            if (!root) return;

            const so = root.getElementById('uw-a11y-inspector-hub-status-outline');
            if (so) {
                if (this.isOutlineViewActive) {
                    const c = root.getElementById('uw-a11y-outline-count');
                    so.textContent = (c && c.style.display !== 'none' && c.textContent)
                        ? c.textContent
                        : 'Outline list open';
                } else {
                    so.textContent = 'Not showing outline';
                }
            }

            const sl = root.getElementById('uw-a11y-inspector-hub-status-links');
            if (sl) {
                if (this.isLinksViewActive) {
                    const c = root.getElementById('uw-a11y-links-count');
                    sl.textContent = (c && c.style.display !== 'none' && c.textContent)
                        ? c.textContent
                        : 'Links list open';
                } else {
                    sl.textContent = 'Not showing links';
                }
            }

            const sc = root.getElementById('uw-a11y-inspector-hub-status-cvd');
            if (sc) {
                const list = root.getElementById('uw-a11y-cvd-list');
                const checked = list && list.querySelector('input[name="uw-a11y-cvd"]:checked');
                if (!checked || checked.value === 'none') {
                    sc.textContent = 'Off — normal vision';
                } else {
                    const label = checked.closest('label');
                    const nameEl = label && label.querySelector('.uw-a11y-cvd-name');
                    sc.textContent = nameEl ? nameEl.textContent.trim() : 'Simulation on';
                }
            }

            const sa = root.getElementById('uw-a11y-inspector-hub-status-alt');
            if (sa) {
                const parts = [];
                if (this.isAltTextListActive) {
                    const c = root.getElementById('uw-a11y-alt-count');
                    parts.push(c && c.textContent ? 'List: ' + c.textContent : 'List on');
                }
                if (this.isAltTextOverlayActive) parts.push('Overlays on');
                sa.textContent = parts.length ? parts.join(' · ') : 'Off';
            }

            const scc = root.getElementById('uw-a11y-inspector-hub-status-contrast');
            if (scc) {
                const s = this.contrastCheckerState;
                if (s && s.ratio != null) {
                    scc.textContent = `${s.ratio.toFixed(2)}:1 — ${s.fg.toUpperCase()} on ${s.bg.toUpperCase()}`;
                } else {
                    scc.textContent = 'No colors picked';
                }
            }
        },

        // Initialize inspector tools event handlers
        initInspectorTools: function() {
            // Overlay tool slide toggles. The toggle*Visualization functions
            // flip internal state (isTabOrderActive, etc.) and show/hide the
            // page overlay; we just hook the checkbox change event to them and
            // sync each checkbox to the current state on init so re-entering
            // the Inspector view reflects whatever's actually on the page.
            const tabOrderToggle = this.shadowRoot.getElementById('uw-a11y-tab-order-toggle');
            if (tabOrderToggle) {
                tabOrderToggle.checked = !!this.isTabOrderActive;
                tabOrderToggle.addEventListener('change', () => this.toggleTabOrderVisualization());
            }

            const focusIndicatorsToggle = this.shadowRoot.getElementById('uw-a11y-focus-indicators-toggle');
            if (focusIndicatorsToggle) {
                focusIndicatorsToggle.checked = !!this.isFocusIndicatorsActive;
                focusIndicatorsToggle.addEventListener('change', () => this.toggleFocusIndicatorsVisualization());
            }

            const landmarkStructureToggle = this.shadowRoot.getElementById('uw-a11y-landmark-structure-toggle');
            if (landmarkStructureToggle) {
                landmarkStructureToggle.checked = !!this.isLandmarkStructureActive;
                landmarkStructureToggle.addEventListener('change', () => this.toggleLandmarkStructureVisualization());
            }

            // Outline / Links / Alt list — these sub-pages auto-show their list
            // on entry (see _autoActivateInspectorDetailPanel) so there's no
            // user-facing toggle for them anymore.

            // Color blindness simulation radio group
            const cvdList = this.shadowRoot.getElementById('uw-a11y-cvd-list');
            if (cvdList) {
                cvdList.addEventListener('change', (e) => {
                    const target = e.target;
                    if (target && target.name === 'uw-a11y-cvd' && target.checked) {
                        this.setColorBlindnessSimulation(target.value);
                    }
                });
            }

            // Alt-text overlays slide toggle (only the page-overlay variant
            // remains as a user-facing control; the list itself auto-shows).
            const altOverlayToggle = this.shadowRoot.getElementById('uw-a11y-alt-overlay-toggle');
            if (altOverlayToggle) {
                altOverlayToggle.checked = !!this.isAltTextOverlayActive;
                altOverlayToggle.addEventListener('change', () => this.toggleAltTextOverlay());
            }

            const openOutline = this.shadowRoot.getElementById('uw-a11y-inspector-open-outline');
            if (openOutline) {
                openOutline.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openInspectorDetail('outline');
                });
            }
            const openLinks = this.shadowRoot.getElementById('uw-a11y-inspector-open-links');
            if (openLinks) {
                openLinks.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openInspectorDetail('links');
                });
            }
            const openCvd = this.shadowRoot.getElementById('uw-a11y-inspector-open-cvd');
            if (openCvd) {
                openCvd.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openInspectorDetail('cvd');
                });
            }
            const openAlt = this.shadowRoot.getElementById('uw-a11y-inspector-open-alt');
            if (openAlt) {
                openAlt.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openInspectorDetail('alt');
                });
            }

            const openContrast = this.shadowRoot.getElementById('uw-a11y-inspector-open-contrast');
            if (openContrast) {
                openContrast.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openInspectorDetail('contrast');
                });
            }

            this.initContrastChecker();

            const backBtn = this.shadowRoot.getElementById('uw-a11y-inspector-back');
            if (backBtn) {
                backBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.closeInspectorDetail();
                });
            }

            const panel = this.shadowRoot.getElementById('uw-a11y-panel');
            if (panel && !this._inspectorDetailEscapeBound) {
                this._inspectorDetailEscapeBound = true;
                panel.addEventListener('keydown', (e) => {
                    if (e.key !== 'Escape' || !this.inspectorSubView || this.currentView !== 'inspector') return;
                    if (this.isPickerActive) return;
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeInspectorDetail();
                }, true);
            }

            this.syncInspectorHubStatus();
        },

        // ── Contrast checker ─────────────────────────────────────────────
        initContrastChecker: function() {
            if (this._contrastCheckerInitialized) return;
            this._contrastCheckerInitialized = true;

            this.contrastCheckerState = { fg: '#000000', bg: '#ffffff', ratio: null };

            const root = this.shadowRoot;
            if (!root) return;

            const hexFg = root.getElementById('uw-a11y-contrast-hex-fg');
            const hexBg = root.getElementById('uw-a11y-contrast-hex-bg');
            const colorFg = root.getElementById('uw-a11y-contrast-color-fg');
            const colorBg = root.getElementById('uw-a11y-contrast-color-bg');
            const pickElementBtn = root.getElementById('uw-a11y-contrast-pick-element');
            const swapBtn = root.getElementById('uw-a11y-contrast-swap');
            const resetBtn = root.getElementById('uw-a11y-contrast-reset');

            const onHexInput = (role, input) => {
                const v = (input.value || '').trim();
                const hex = this.normalizeHexColor(v);
                if (hex) this.setContrastColor(role, hex, { source: 'hex' });
            };
            if (hexFg) hexFg.addEventListener('change', () => onHexInput('foreground', hexFg));
            if (hexBg) hexBg.addEventListener('change', () => onHexInput('background', hexBg));
            if (hexFg) hexFg.addEventListener('blur', () => onHexInput('foreground', hexFg));
            if (hexBg) hexBg.addEventListener('blur', () => onHexInput('background', hexBg));
            if (colorFg) colorFg.addEventListener('input', () => this.setContrastColor('foreground', colorFg.value, { source: 'color' }));
            if (colorBg) colorBg.addEventListener('input', () => this.setContrastColor('background', colorBg.value, { source: 'color' }));

            if (pickElementBtn) pickElementBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.startContrastPickerMode();
            });

            if (swapBtn) swapBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const s = this.contrastCheckerState;
                const fg = s.fg, bg = s.bg;
                this.setContrastColor('foreground', bg, { silent: true });
                this.setContrastColor('background', fg);
            });

            if (resetBtn) resetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.setContrastColor('foreground', '#000000', { silent: true });
                this.setContrastColor('background', '#ffffff');
            });

            this.recomputeContrastResult();
        },

        // Accept '#abc', '#aabbcc', 'rgb(...)' and return '#rrggbb' (or null).
        normalizeHexColor: function(value) {
            if (!value) return null;
            const v = String(value).trim().toLowerCase();
            const hexMatch = v.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
            if (hexMatch) {
                let h = hexMatch[1];
                if (h.length === 3) h = h.split('').map(c => c + c).join('');
                return '#' + h;
            }
            const rgbMatch = v.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (rgbMatch) {
                const r = Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10)));
                const g = Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10)));
                const b = Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10)));
                return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
            }
            return null;
        },

        setContrastColor: function(role, hexInput, opts) {
            const hex = this.normalizeHexColor(hexInput);
            if (!hex) return;
            const state = this.contrastCheckerState || (this.contrastCheckerState = { fg: '#000000', bg: '#ffffff', ratio: null });
            if (role === 'foreground') state.fg = hex;
            else if (role === 'background') state.bg = hex;
            else return;

            const root = this.shadowRoot;
            if (!root) return;

            const suffix = role === 'foreground' ? 'fg' : 'bg';
            const hexInputEl = root.getElementById('uw-a11y-contrast-hex-' + suffix);
            const colorInputEl = root.getElementById('uw-a11y-contrast-color-' + suffix);
            if (hexInputEl && hexInputEl.value.toLowerCase() !== hex) hexInputEl.value = hex;
            if (colorInputEl && colorInputEl.value.toLowerCase() !== hex) colorInputEl.value = hex;

            if (!opts || !opts.silent) this.recomputeContrastResult();
        },

        recomputeContrastResult: function() {
            const root = this.shadowRoot;
            const state = this.contrastCheckerState;
            if (!root || !state) return;

            const preview = root.getElementById('uw-a11y-contrast-preview');
            if (preview) {
                preview.style.color = state.fg;
                preview.style.background = state.bg;
            }

            const ratio = this.calculateContrastRatio(state.fg, state.bg);
            state.ratio = ratio;

            const ratioValue = root.getElementById('uw-a11y-contrast-ratio-value');
            if (ratioValue) ratioValue.textContent = ratio != null ? `${ratio.toFixed(2)}:1` : '—';

            const checks = [
                { key: 'aa-normal', threshold: 4.5 },
                { key: 'aa-large', threshold: 3.0 },
                { key: 'aaa-normal', threshold: 7.0 },
                { key: 'aaa-large', threshold: 4.5 },
                { key: 'ui', threshold: 3.0 }
            ];
            const list = root.getElementById('uw-a11y-contrast-checks');
            if (list) {
                checks.forEach(({ key, threshold }) => {
                    const li = list.querySelector(`[data-check="${key}"]`);
                    if (!li) return;
                    const badge = li.querySelector('.uw-a11y-contrast-check-badge');
                    li.classList.remove('is-pass', 'is-fail');
                    if (ratio == null) {
                        if (badge) badge.textContent = '—';
                    } else if (ratio >= threshold) {
                        li.classList.add('is-pass');
                        if (badge) badge.textContent = 'Pass';
                    } else {
                        li.classList.add('is-fail');
                        if (badge) badge.textContent = 'Fail';
                    }
                });
            }

            this.syncInspectorHubStatus();
            if (this.currentView === 'inspector') this.syncInspectorContentHeight();
        },

        // Detect a gradient on the element or up to 3 ancestors. Skips thin
        // decorative gradients (background-size height ≤ 4px). Returns
        // { gradientCss, gradientEl } or null.
        findContrastGradientSource: function(el) {
            const check = (node) => {
                if (!node || node.nodeType !== 1) return null;
                const cs = window.getComputedStyle(node);
                const bgImg = cs.backgroundImage;
                if (!bgImg || bgImg === 'none' || !bgImg.includes('gradient')) return null;
                const bgSize = cs.backgroundSize;
                if (bgSize) {
                    const parts = bgSize.trim().split(/\s+/);
                    const heightStr = parts[1] || parts[0];
                    const pxMatch = heightStr && heightStr.match(/^([\d.]+)px$/);
                    if (pxMatch && parseFloat(pxMatch[1]) <= 4) return null;
                }
                return bgImg;
            };

            let g = check(el);
            if (g) return { gradientCss: g, gradientEl: el };
            let anc = el.parentElement;
            for (let d = 0; d < 3 && anc; d++, anc = anc.parentElement) {
                g = check(anc);
                if (g) return { gradientCss: g, gradientEl: anc };
            }
            return null;
        },

        // Sample fg + bg for the contrast checker, handling gradients by
        // delegating to analyzeGradientBackground (worst-case stop within the
        // text element's region, matching how the scan engine reports it).
        sampleElementContrastColors: function(el) {
            const fgCss = window.getComputedStyle(el).color;
            const fgHex = this.normalizeHexColor(fgCss);

            const gradient = this.findContrastGradientSource(el);
            if (gradient && fgCss) {
                const result = this.analyzeGradientBackground(gradient.gradientCss, fgCss, el, gradient.gradientEl);
                if (result && result.background) {
                    const bgHex = this.normalizeHexColor(result.background);
                    if (bgHex) {
                        return { fg: fgHex, bg: bgHex, gradient: true, sampleCount: result.sampleCount };
                    }
                }
            }

            return { fg: fgHex, bg: this.getElementEffectiveBackground(el), gradient: false };
        },

        // Walk up the ancestor chain to find the first non-transparent background-color.
        getElementEffectiveBackground: function(el) {
            let node = el;
            while (node && node.nodeType === 1) {
                const cs = window.getComputedStyle(node);
                const bg = cs.backgroundColor;
                if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
                    const m = bg.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
                    if (m) {
                        const alpha = m[4] != null ? parseFloat(m[4]) : 1;
                        if (alpha > 0) {
                            const r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10);
                            return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
                        }
                    }
                }
                node = node.parentElement;
            }
            return '#ffffff';
        },

        // Picker mode dedicated to sampling colors for the contrast tool.
        // Samples both foreground (computed `color`) and background (effective
        // ancestor `background-color`) from a single element click.
        startContrastPickerMode: function() {
            if (this.isPickerActive) return;
            this.isPickerActive = true;

            const wrapper = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-wrapper');
            if (wrapper) {
                wrapper.dataset.pickerOrigOpacity = wrapper.style.opacity || '';
                wrapper.style.opacity = '0.15';
                wrapper.style.pointerEvents = 'none';
            }

            this.injectPickerStyles();

            const highlight = document.createElement('div');
            highlight.id = 'uw-a11y-picker-highlight';
            highlight.setAttribute('aria-hidden', 'true');
            document.body.appendChild(highlight);
            this.pickerHighlightEl = highlight;

            const tooltip = document.createElement('div');
            tooltip.id = 'uw-a11y-picker-tooltip';
            tooltip.setAttribute('aria-hidden', 'true');
            document.body.appendChild(tooltip);
            this.pickerTooltipEl = tooltip;

            const doneBtn = document.createElement('button');
            doneBtn.id = 'uw-a11y-picker-done';
            doneBtn.textContent = 'Cancel — click any element to sample its colors';
            doneBtn.setAttribute('aria-label', 'Cancel picking and return to contrast checker');
            document.body.appendChild(doneBtn);
            this.pickerDoneBtn = doneBtn;
            doneBtn.addEventListener('click', () => this.stopContrastPickerMode());

            document.body.style.cursor = 'crosshair';
            this.playSound('ui');

            this._pickerMoveHandler = (e) => this.onContrastPickerMouseMove(e);
            this._pickerClickHandler = (e) => this.onContrastPickerClick(e);
            this._pickerKeyHandler = (e) => { if (e.key === 'Escape') this.stopContrastPickerMode(); };

            document.addEventListener('mousemove', this._pickerMoveHandler);
            document.addEventListener('click', this._pickerClickHandler, true);
            document.addEventListener('keydown', this._pickerKeyHandler, true);
        },

        stopContrastPickerMode: function() {
            if (!this.isPickerActive) return;
            this.isPickerActive = false;

            const wrapper = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-wrapper');
            if (wrapper) {
                wrapper.style.opacity = wrapper.dataset.pickerOrigOpacity || '';
                wrapper.style.pointerEvents = '';
                delete wrapper.dataset.pickerOrigOpacity;
            }

            if (this.pickerHighlightEl) { this.pickerHighlightEl.remove(); this.pickerHighlightEl = null; }
            if (this.pickerTooltipEl) { this.pickerTooltipEl.remove(); this.pickerTooltipEl = null; }
            if (this.pickerDoneBtn) { this.pickerDoneBtn.remove(); this.pickerDoneBtn = null; }

            const st = document.getElementById('uw-a11y-picker-styles');
            if (st) st.remove();

            if (this._pickerMoveHandler) document.removeEventListener('mousemove', this._pickerMoveHandler);
            if (this._pickerClickHandler) document.removeEventListener('click', this._pickerClickHandler, true);
            if (this._pickerKeyHandler) document.removeEventListener('keydown', this._pickerKeyHandler, true);
            this._pickerMoveHandler = null;
            this._pickerClickHandler = null;
            this._pickerKeyHandler = null;

            document.body.style.cursor = '';
            this.playSound('ui');
        },

        onContrastPickerMouseMove: function(e) {
            const el = this.getPickerTargetAt(e.clientX, e.clientY);
            if (!el) {
                if (this.pickerHighlightEl) this.pickerHighlightEl.style.display = 'none';
                if (this.pickerTooltipEl) this.pickerTooltipEl.style.display = 'none';
                return;
            }
            const rect = el.getBoundingClientRect();
            const h = this.pickerHighlightEl;
            if (h) {
                h.style.display = 'block';
                h.style.left   = (rect.left + window.scrollX) + 'px';
                h.style.top    = (rect.top  + window.scrollY) + 'px';
                h.style.width  = rect.width  + 'px';
                h.style.height = rect.height + 'px';
            }
            const t = this.pickerTooltipEl;
            if (t) {
                t.style.display = 'block';
                const sample = this.sampleElementContrastColors(el);
                const fgLabel = sample.fg ? sample.fg.toUpperCase() : '?';
                const bgLabel = sample.bg ? sample.bg.toUpperCase() : '?';
                const tail = sample.gradient ? ' (gradient · worst stop)' : '';
                t.textContent = `${this.getPickerBadgeText(el)} — ${fgLabel} on ${bgLabel}${tail}`;
                const badgeTop = rect.top + window.scrollY - 28;
                t.style.left = (rect.left + window.scrollX) + 'px';
                t.style.top  = (badgeTop > 0 ? badgeTop : rect.bottom + window.scrollY + 4) + 'px';
            }
        },

        onContrastPickerClick: function(e) {
            const el = this.getPickerTargetAt(e.clientX, e.clientY);
            if (!el) return;

            e.preventDefault();
            e.stopPropagation();

            const sample = this.sampleElementContrastColors(el);

            if (sample.fg) this.setContrastColor('foreground', sample.fg, { silent: true });
            if (sample.bg) this.setContrastColor('background', sample.bg);

            if (sample.fg || sample.bg) {
                this.playSound('verify');
                if (this.pickerHighlightEl) this.pickerHighlightEl.classList.add('uw-a11y-picker-selected');
            }

            setTimeout(() => this.stopContrastPickerMode(), 350);
        },

        // Toggle heading outline view (in-panel, not a page overlay)
        toggleOutlineView: function() {
            const isActive = this.isOutlineViewActive || false;
            this.isOutlineViewActive = !isActive;

            const btn = this.shadowRoot.getElementById('uw-a11y-outline-toggle');
            const countEl = this.shadowRoot.getElementById('uw-a11y-outline-count');
            const content = this.shadowRoot.getElementById('uw-a11y-outline-content');

            if (!isActive) {
                // Show outline
                if (content) {
                    content.hidden = false;
                    this.renderOutlineView(content, countEl);
                }
                if (btn) {
                    btn.setAttribute('aria-pressed', 'true');
                    btn.setAttribute('aria-expanded', 'true');
                    btn.classList.add('active');
                    const listIcon = btn.querySelector('.feather-list');
                    const eyeOffIcon = btn.querySelector('.feather-eye-off');
                    if (listIcon) listIcon.style.display = 'none';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'inline';
                    const btnText = btn.querySelector('.uw-a11y-btn-text');
                    if (btnText) btnText.textContent = 'Hide Outline';
                }
                if (countEl) countEl.style.display = 'inline';
            } else {
                // Hide outline
                if (content) { content.hidden = true; content.innerHTML = ''; }
                if (btn) {
                    btn.setAttribute('aria-pressed', 'false');
                    btn.setAttribute('aria-expanded', 'false');
                    btn.classList.remove('active');
                    const listIcon = btn.querySelector('.feather-list');
                    const eyeOffIcon = btn.querySelector('.feather-eye-off');
                    if (listIcon) listIcon.style.display = 'inline';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'none';
                    const btnText = btn.querySelector('.uw-a11y-btn-text');
                    if (btnText) btnText.textContent = 'Show Outline';
                }
                if (countEl) countEl.style.display = 'none';
            }
            this.syncInspectorHubStatus();
            if (this.currentView === 'inspector') this.syncInspectorContentHeight();
        },

        // Render the heading outline tree into the given container
        renderOutlineView: function(container, countEl) {
            const headings = this.detectHeadings();

            if (!headings.length) {
                container.innerHTML = '<p class="uw-a11y-outline-item"><span class="uw-a11y-outline-empty-text">No headings found on this page.</span></p>';
                if (countEl) countEl.textContent = 'No headings found';
                return;
            }

            // Level colors: H1-H6
            const levelColors = [
                null,
                { bg: '#dbeafe', color: '#1d4ed8' }, // H1 blue
                { bg: '#ede9fe', color: '#6d28d9' }, // H2 purple
                { bg: '#d1fae5', color: '#065f46' }, // H3 green
                { bg: '#fef3c7', color: '#92400e' }, // H4 amber
                { bg: '#fee2e2', color: '#991b1b' }, // H5 red
                { bg: '#f3f4f6', color: '#374151' }, // H6 gray
            ];

            // Build items list — interleave skip warnings when level jumps down
            let issueCount = 0;
            const items = [];
            let prevLevel = 0;

            headings.forEach((heading) => {
                const level = heading.level;
                if (prevLevel > 0 && level > prevLevel + 1) {
                    items.push({ type: 'skip', from: prevLevel, to: level });
                    issueCount++;
                }
                items.push({ type: 'heading', heading, level });
                prevLevel = level;
            });

            // Build HTML rows
            const warnSvg = `<svg fill="none" height="13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="13" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`;

            const rows = items.map((item) => {
                if (item.type === 'skip') {
                    return `<div class="uw-a11y-outline-skip" role="alert">${warnSvg}<span>Skipped level: H${item.from} → H${item.to}</span></div>`;
                }
                const { heading, level } = item;
                const col = levelColors[level] || levelColors[6];
                const indent = (level - 1) * 14;
                const safeText = heading.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                const headingDataIdx = headings.indexOf(heading);
                return `<button class="uw-a11y-outline-item" data-hi="${headingDataIdx}" style="padding-left:${indent + 8}px;" title="Jump to: ${safeText}">
                    <span class="uw-a11y-outline-badge" style="background:${col.bg};color:${col.color};">H${level}</span>
                    <span class="uw-a11y-outline-text">${safeText || '<em>(empty)</em>'}</span>
                </button>`;
            }).join('');

            container.innerHTML = `<div class="uw-a11y-outline-list">${rows}</div>`;

            // Update summary count
            if (countEl) {
                countEl.textContent = issueCount > 0
                    ? `${headings.length} headings · ${issueCount} order issue${issueCount !== 1 ? 's' : ''}`
                    : `${headings.length} headings · No order issues`;
                countEl.style.color = issueCount > 0 ? '#b45309' : '#059669';
            }

            // Wire click-to-scroll for each heading button
            container.querySelectorAll('.uw-a11y-outline-item[data-hi]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.hi, 10);
                    const target = headings[idx] && headings[idx].element;
                    if (!target) return;
                    this.scrollAndFlashTarget(target);
                });
            });
        },

        // Briefly highlight an element on the page and scroll it into view.
        // Shared by the outline and link-list inspectors.
        scrollAndFlashTarget: function(target) {
            if (!target) return;
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const prevOutline = target.style.outline;
            const prevOffset = target.style.outlineOffset;
            const prevTransition = target.style.transition;
            target.style.transition = 'outline 0.15s';
            target.style.outline = '3px solid #4f46e5';
            target.style.outlineOffset = '4px';
            setTimeout(() => {
                target.style.outline = prevOutline;
                target.style.outlineOffset = prevOffset;
                target.style.transition = prevTransition;
            }, 1800);
        },

        // Toggle the Links inspector (in-panel list — does not annotate the page)
        toggleLinksView: function() {
            const isActive = this.isLinksViewActive || false;
            this.isLinksViewActive = !isActive;

            const btn = this.shadowRoot.getElementById('uw-a11y-links-toggle');
            const countEl = this.shadowRoot.getElementById('uw-a11y-links-count');
            const content = this.shadowRoot.getElementById('uw-a11y-links-content');

            if (!isActive) {
                if (content) {
                    content.hidden = false;
                    this.renderLinksView(content, countEl);
                }
                if (btn) {
                    btn.setAttribute('aria-pressed', 'true');
                    btn.setAttribute('aria-expanded', 'true');
                    btn.classList.add('active');
                    const linkIcon = btn.querySelector('.feather-link');
                    const eyeOffIcon = btn.querySelector('.feather-eye-off');
                    if (linkIcon) linkIcon.style.display = 'none';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'inline';
                    const btnText = btn.querySelector('.uw-a11y-btn-text');
                    if (btnText) btnText.textContent = 'Hide Links';
                }
                if (countEl) countEl.style.display = 'inline';
            } else {
                if (content) { content.hidden = true; content.innerHTML = ''; }
                if (btn) {
                    btn.setAttribute('aria-pressed', 'false');
                    btn.setAttribute('aria-expanded', 'false');
                    btn.classList.remove('active');
                    const linkIcon = btn.querySelector('.feather-link');
                    const eyeOffIcon = btn.querySelector('.feather-eye-off');
                    if (linkIcon) linkIcon.style.display = 'inline';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'none';
                    const btnText = btn.querySelector('.uw-a11y-btn-text');
                    if (btnText) btnText.textContent = 'Show Links';
                }
                if (countEl) countEl.style.display = 'none';
            }
            this.syncInspectorHubStatus();
            if (this.currentView === 'inspector') this.syncInspectorContentHeight();
        },

        // Render the links list into the given container
        renderLinksView: function(container, countEl) {
            const links = this.detectLinks();

            if (!links.length) {
                container.innerHTML = '<p class="uw-a11y-outline-item"><span class="uw-a11y-outline-empty-text">No links found on this page.</span></p>';
                if (countEl) {
                    countEl.textContent = 'No links found';
                    countEl.style.color = '#6b7280';
                }
                return;
            }

            const warnSvg = `<svg fill="none" height="12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`;

            let issueCount = 0;
            const rows = links.map((link, idx) => {
                const hasIssue = link.issues.length > 0;
                if (hasIssue) issueCount++;
                const badge = link.type;
                const name = link.accName;
                const safeName = this.escapeHtmlContent(name);
                const safeHref = this.escapeHtmlContent(link.href || '');
                const titleText = this.escapeHtmlAttribute(
                    (name ? `Announced as: "${name}"` : 'No accessible name') +
                    (link.href ? `\n${link.href}` : '') +
                    (hasIssue ? `\n\n${link.issues.join('\n')}` : '')
                );

                const nameHtml = name
                    ? `<span class="uw-a11y-link-name">${safeName}</span>`
                    : `<span class="uw-a11y-link-name is-empty">(no accessible name)</span>`;

                const urlHtml = link.href
                    ? `<span class="uw-a11y-link-url">${safeHref}</span>`
                    : '';

                const issuesHtml = hasIssue
                    ? `<span class="uw-a11y-link-issues">${warnSvg}<span>${this.escapeHtmlContent(link.issues.join(' · '))}</span></span>`
                    : '';

                return `<button class="uw-a11y-link-row${hasIssue ? ' has-issue' : ''}" data-li="${idx}" title="${titleText}">
                    <span class="uw-a11y-link-badge" style="background:${badge.bg};color:${badge.color};">${badge.label}</span>
                    <span class="uw-a11y-link-main">
                        ${nameHtml}
                        ${urlHtml}
                        ${issuesHtml}
                    </span>
                </button>`;
            }).join('');

            container.innerHTML = `<div class="uw-a11y-outline-list">${rows}</div>`;

            if (countEl) {
                countEl.textContent = issueCount > 0
                    ? `${links.length} link${links.length !== 1 ? 's' : ''} · ${issueCount} issue${issueCount !== 1 ? 's' : ''}`
                    : `${links.length} link${links.length !== 1 ? 's' : ''} · No issues`;
                countEl.style.color = issueCount > 0 ? '#b45309' : '#059669';
            }

            container.querySelectorAll('.uw-a11y-link-row[data-li]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.li, 10);
                    const target = links[idx] && links[idx].element;
                    this.scrollAndFlashTarget(target);
                });
            });
        },

        // Gather all links on the page with computed accessible names and issue flags
        detectLinks: function() {
            const nodes = Array.from(document.querySelectorAll('a'));
            const links = [];

            nodes.forEach(el => {
                // Skip any links inside the Pinpoint UI
                if (el.closest('uw-accessibility-checker') ||
                    el.closest('[data-uw-a11y-overlay]') ||
                    el.closest('#uw-a11y-panel')) return;

                // Skip links that aren't rendered (display:none / visibility:hidden).
                // Keep aria-hidden links in the list so screen-reader-hidden links can be reviewed too.
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return;

                // Require an href attribute — anchors without href are not focusable/announced
                if (!el.hasAttribute('href')) return;

                const href = el.getAttribute('href') || '';
                const accName = this.computeLinkAccessibleName(el);
                const type = this.classifyLink(href);
                const issues = this.detectLinkIssues(el, accName, href);

                links.push({ element: el, href, accName, type, issues });
            });

            return links;
        },

        // Compute a simplified accessible name for a link element.
        // Follows the spec precedence loosely: aria-labelledby → aria-label → text/alt → title.
        computeLinkAccessibleName: function(el) {
            const labelledBy = el.getAttribute('aria-labelledby');
            if (labelledBy) {
                const parts = labelledBy.split(/\s+/).filter(Boolean).map(id => {
                    const ref = document.getElementById(id);
                    return ref ? (ref.textContent || '').trim() : '';
                }).filter(Boolean);
                if (parts.length) return parts.join(' ').replace(/\s+/g, ' ').trim();
            }

            const ariaLabel = (el.getAttribute('aria-label') || '').trim();
            if (ariaLabel) return ariaLabel;

            const fromContent = this.extractAccessibleText(el);
            if (fromContent) return fromContent;

            const title = (el.getAttribute('title') || '').trim();
            if (title) return title;

            return '';
        },

        // Walk an element's descendants collecting text + image alt text that a
        // screen reader would announce. Skips aria-hidden subtrees.
        extractAccessibleText: function(node) {
            if (!node) return '';
            const parts = [];
            const walk = (current) => {
                if (!current) return;
                if (current.nodeType === Node.TEXT_NODE) {
                    const txt = current.textContent;
                    if (txt) parts.push(txt);
                    return;
                }
                if (current.nodeType !== Node.ELEMENT_NODE) return;
                if (current.getAttribute && current.getAttribute('aria-hidden') === 'true') return;

                const tag = current.tagName;
                if (tag === 'IMG') {
                    const alt = current.getAttribute('alt');
                    if (alt) parts.push(alt);
                    return;
                }
                if (tag === 'SVG' || tag === 'svg') {
                    const svgLabel = current.getAttribute('aria-label');
                    if (svgLabel) { parts.push(svgLabel); return; }
                    const titleEl = current.querySelector && current.querySelector('title');
                    if (titleEl && titleEl.textContent) { parts.push(titleEl.textContent); return; }
                    return;
                }
                // Use nested aria-label if present
                const nestedLabel = current.getAttribute && current.getAttribute('aria-label');
                if (nestedLabel) { parts.push(nestedLabel); return; }

                current.childNodes.forEach(walk);
            };
            node.childNodes.forEach(walk);
            return parts.join(' ').replace(/\s+/g, ' ').trim();
        },

        // Return a badge descriptor { label, bg, color } for the link type
        classifyLink: function(href) {
            const gray = { bg: '#f3f4f6', color: '#374151' };
            if (!href || href === '#') return { label: 'NONE', ...gray };

            const lower = href.toLowerCase();
            if (lower.startsWith('mailto:')) return { label: 'MAIL', bg: '#fef3c7', color: '#92400e' };
            if (lower.startsWith('tel:')) return { label: 'TEL', bg: '#fef3c7', color: '#92400e' };
            if (lower.startsWith('javascript:')) return { label: 'JS', bg: '#fee2e2', color: '#991b1b' };
            if (href.startsWith('#')) return { label: 'IN', bg: '#dbeafe', color: '#1d4ed8' };

            try {
                const url = new URL(href, document.baseURI);
                if (url.origin && url.origin !== window.location.origin) {
                    return { label: 'EXT', bg: '#ede9fe', color: '#6d28d9' };
                }
                return { label: 'INT', bg: '#d1fae5', color: '#065f46' };
            } catch (e) {
                return { label: 'INT', bg: '#d1fae5', color: '#065f46' };
            }
        },

        // Identify common link-text problems a screen-reader user would encounter
        detectLinkIssues: function(el, accName, href) {
            const issues = [];
            const name = (accName || '').trim();

            if (!name) {
                issues.push('No accessible name');
            } else {
                const lc = name.toLowerCase();
                const generic = new Set([
                    'click here', 'click', 'here', 'read more', 'more', 'learn more',
                    'continue', 'continue reading', 'details', 'link', 'this link',
                    'this', 'info', 'more info', 'go', 'view'
                ]);
                if (generic.has(lc)) {
                    issues.push(`Generic link text ("${name}")`);
                }
                if (/^https?:\/\//i.test(name) && name.length > 25) {
                    issues.push('Raw URL used as link text');
                }
            }

            const target = el.getAttribute('target');
            if (target === '_blank') {
                const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                const title = (el.getAttribute('title') || '').toLowerCase();
                const combined = `${name.toLowerCase()} ${ariaLabel} ${title}`;
                if (!/(new tab|new window|opens in)/.test(combined)) {
                    issues.push('Opens in new tab without warning');
                }
            }

            if (href === '#' || /^javascript:/i.test(href || '')) {
                // Non-real destinations - only flag when there's also no role
                const role = el.getAttribute('role');
                if (role !== 'button') {
                    issues.push('Link has no real destination');
                }
            }

            return issues;
        },

        // Color vision deficiency filter matrices. Values operate on sRGB channels
        // (we set color-interpolation-filters="sRGB" so the matrix applies in sRGB space).
        // Matrices from the commonly cited Machado/Oliveira/Fernandes and Brettel models.
        getCvdFilterMatrices: function() {
            return {
                deuteranomaly:  '0.8 0.2 0 0 0  0.258 0.742 0 0 0  0 0.142 0.858 0 0  0 0 0 1 0',
                deuteranopia:   '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
                protanomaly:    '0.817 0.183 0 0 0  0.333 0.667 0 0 0  0 0.125 0.875 0 0  0 0 0 1 0',
                protanopia:     '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
                tritanomaly:    '0.967 0.033 0 0 0  0 0.733 0.267 0 0  0 0.183 0.817 0 0  0 0 0 1 0',
                tritanopia:     '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
                achromatomaly:  '0.618 0.320 0.062 0 0  0.163 0.775 0.062 0 0  0.163 0.320 0.516 0 0  0 0 0 1 0',
                achromatopsia:  '0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0'
            };
        },

        // Apply a color vision deficiency filter to everything on the page except
        // the Pinpoint panel itself. Passing 'none' (or falsy) removes the simulation.
        setColorBlindnessSimulation: function(type) {
            if (!type || type === 'none') {
                this.removeColorBlindnessSimulation();
                return;
            }

            const matrices = this.getCvdFilterMatrices();
            if (!matrices[type]) {
                this.removeColorBlindnessSimulation();
                return;
            }

            this.injectColorBlindnessFilterDefs();
            this.injectColorBlindnessStyles();

            // data attribute drives the CSS variable + filter selector
            document.body.setAttribute('data-uw-a11y-cvd', type);
            this.activeColorBlindness = type;
            this.syncInspectorHubStatus();
        },

        // Remove the CVD simulation and associated DOM nodes
        removeColorBlindnessSimulation: function() {
            document.body.removeAttribute('data-uw-a11y-cvd');
            this.activeColorBlindness = null;

            const defs = document.getElementById('uw-a11y-cvd-filter-defs');
            if (defs) defs.remove();

            const styles = document.getElementById('uw-a11y-cvd-styles');
            if (styles) styles.remove();
            if (this.shadowRoot) this.syncInspectorHubStatus();
        },

        // Inject <svg><defs><filter>…</filter></defs></svg> containing one filter per
        // CVD type. The SVG is hidden (0x0) and lives in <body> so filter url(#…) refs
        // resolve in the same document.
        injectColorBlindnessFilterDefs: function() {
            if (document.getElementById('uw-a11y-cvd-filter-defs')) return;

            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('id', 'uw-a11y-cvd-filter-defs');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('width', '0');
            svg.setAttribute('height', '0');
            svg.style.position = 'absolute';
            svg.style.width = '0';
            svg.style.height = '0';
            svg.style.overflow = 'hidden';
            svg.style.pointerEvents = 'none';

            const defs = document.createElementNS(svgNS, 'defs');
            const matrices = this.getCvdFilterMatrices();
            Object.keys(matrices).forEach(type => {
                const filter = document.createElementNS(svgNS, 'filter');
                filter.setAttribute('id', `uw-a11y-cvd-${type}`);
                // sRGB so the matrix operates on gamma-corrected channels (what the
                // standard matrices are designed for — otherwise linearRGB washes out).
                filter.setAttribute('color-interpolation-filters', 'sRGB');
                const matrix = document.createElementNS(svgNS, 'feColorMatrix');
                matrix.setAttribute('type', 'matrix');
                matrix.setAttribute('values', matrices[type]);
                filter.appendChild(matrix);
                defs.appendChild(filter);
            });
            svg.appendChild(defs);
            document.body.appendChild(svg);
        },

        // Inject the CSS that applies the filter to every direct child of <body>
        // except the Pinpoint panel and the hidden filter-defs SVG.
        injectColorBlindnessStyles: function() {
            if (document.getElementById('uw-a11y-cvd-styles')) return;

            const matrices = this.getCvdFilterMatrices();
            const perTypeRules = Object.keys(matrices).map(type => (
                `body[data-uw-a11y-cvd="${type}"] { --uw-a11y-cvd-filter: url(#uw-a11y-cvd-${type}); }`
            )).join('\n');

            const styleEl = document.createElement('style');
            styleEl.id = 'uw-a11y-cvd-styles';
            styleEl.textContent = `
                body[data-uw-a11y-cvd] > *:not(uw-accessibility-checker):not(#uw-a11y-cvd-filter-defs):not(#uw-a11y-container) {
                    filter: var(--uw-a11y-cvd-filter);
                }
                ${perTypeRules}
            `;
            document.head.appendChild(styleEl);
        },

        // ================================================================
        // Alternative Text Inspector (in-panel list + page overlays)
        // ================================================================

        // Scan the page for every element that exposes (or should expose) alt text
        // and classify how each one presents itself to assistive tech.
        detectImages: function() {
            const selector = 'img, svg, input[type="image"], area[href], [role="img"]';
            const nodes = Array.from(document.querySelectorAll(selector));
            const results = [];
            const seen = new Set();

            nodes.forEach(el => {
                // Skip anything inside the Pinpoint UI or its overlays
                if (el.closest('uw-accessibility-checker') ||
                    el.closest('[data-uw-a11y-overlay]') ||
                    el.closest('#uw-a11y-panel') ||
                    el.closest('#uw-a11y-container')) return;

                // Deduplicate (an <svg> with role="img" matches both selectors)
                if (seen.has(el)) return;
                seen.add(el);

                // Skip not-rendered elements
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return;

                const info = this.getImageAltInfo(el);
                if (info) results.push(info);
            });

            return results;
        },

        // Compute alt-text metadata for a single image-like element.
        // Returns { element, type, altText, altSource, status, issues }.
        getImageAltInfo: function(el) {
            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            const role = el.getAttribute && el.getAttribute('role');
            const ariaHidden = el.getAttribute && el.getAttribute('aria-hidden') === 'true';
            let altText = '';
            let altSource = null;
            let isDecorative = false;
            let isMissing = false;
            const issues = [];

            // aria-hidden / role="presentation" => decorative
            if (ariaHidden || role === 'presentation' || role === 'none') {
                isDecorative = true;
                altSource = ariaHidden ? 'aria-hidden' : 'role="presentation"';
            }

            // aria-labelledby wins over everything else
            const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
            if (!altText && labelledBy) {
                const parts = labelledBy.split(/\s+/).filter(Boolean).map(id => {
                    const ref = document.getElementById(id);
                    return ref ? (ref.textContent || '').trim() : '';
                }).filter(Boolean);
                if (parts.length) {
                    altText = parts.join(' ').replace(/\s+/g, ' ').trim();
                    altSource = 'aria-labelledby';
                    isDecorative = false;
                }
            }

            // aria-label
            if (!altText) {
                const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
                if (ariaLabel) {
                    altText = ariaLabel.trim();
                    altSource = 'aria-label';
                    if (altText) isDecorative = false;
                }
            }

            // Native alt attribute (img / input[type=image] / area)
            if (!altText && (tag === 'img' || tag === 'input' || tag === 'area')) {
                if (el.hasAttribute('alt')) {
                    const raw = el.getAttribute('alt') || '';
                    altText = raw;
                    altSource = 'alt';
                    if (raw === '') isDecorative = true;
                } else if (!isDecorative) {
                    isMissing = true;
                }
            }

            // SVG: look for a direct <title> child
            if (!altText && tag === 'svg') {
                const titleEl = el.querySelector(':scope > title');
                const titleText = titleEl && titleEl.textContent ? titleEl.textContent.trim() : '';
                if (titleText) {
                    altText = titleText;
                    altSource = '<title>';
                    isDecorative = false;
                } else if (!isDecorative && role !== 'img') {
                    // SVG without role="img" and no title is conventionally decorative
                    isDecorative = true;
                    altSource = altSource || 'implicit (no role="img")';
                }
            }

            // Classify status
            let status;
            if (isMissing) {
                status = 'missing';
                issues.push('Missing alt attribute');
            } else if (isDecorative) {
                status = 'decorative';
            } else if (altText) {
                status = 'has-alt';
            } else {
                // role="img" / SVG with role="img" and no accessible name
                status = 'empty';
                issues.push('Marked as an image but has no accessible name');
            }

            // Heuristic content issues
            if (status === 'has-alt' && altText) {
                const trimmed = altText.trim();
                if (/\.(jpe?g|png|gif|webp|svg|bmp|avif)$/i.test(trimmed)) {
                    issues.push('Alt text is a filename');
                } else if (/^(image|img|photo|picture|graphic|icon)(\s*\d+)?$/i.test(trimmed)) {
                    issues.push('Generic alt text');
                } else if (/^(image|picture|photo|graphic|icon) of /i.test(trimmed)) {
                    issues.push('Alt text starts with redundant "image of…" phrasing');
                }
                if (trimmed.length > 150) {
                    issues.push('Alt text is very long — consider splitting to a longer description');
                }
            }

            return {
                element: el,
                type: tag,
                altText,
                altSource,
                status,
                isDecorative,
                isMissing,
                issues
            };
        },

        // Return a badge descriptor for a given alt-text status
        getAltStatusBadge: function(status) {
            switch (status) {
                case 'has-alt':    return { label: 'ALT',    bg: '#d1fae5', color: '#065f46' };
                case 'decorative': return { label: 'DECOR',  bg: '#dbeafe', color: '#1d4ed8' };
                case 'missing':    return { label: 'MISSING',bg: '#fee2e2', color: '#991b1b' };
                case 'empty':      return { label: 'EMPTY',  bg: '#fee2e2', color: '#991b1b' };
                default:           return { label: '?',      bg: '#f3f4f6', color: '#374151' };
            }
        },

        // Toggle the in-panel alt-text list
        toggleAltTextList: function() {
            const isActive = this.isAltTextListActive || false;
            this.isAltTextListActive = !isActive;

            const btn = this.shadowRoot.getElementById('uw-a11y-alt-list-toggle');
            const countEl = this.shadowRoot.getElementById('uw-a11y-alt-count');
            const content = this.shadowRoot.getElementById('uw-a11y-alt-content');

            if (!isActive) {
                if (content) {
                    content.hidden = false;
                    this.renderAltTextList(content, countEl);
                }
                if (btn) {
                    btn.setAttribute('aria-pressed', 'true');
                    btn.setAttribute('aria-expanded', 'true');
                    btn.classList.add('active');
                    const listIcon = btn.querySelector('.feather-list');
                    const eyeOffIcon = btn.querySelector('.feather-eye-off');
                    if (listIcon) listIcon.style.display = 'none';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'inline';
                    const btnText = btn.querySelector('.uw-a11y-btn-text');
                    if (btnText) btnText.textContent = 'Hide Alt Text List';
                }
                if (countEl) countEl.style.display = 'inline';
            } else {
                if (content) { content.hidden = true; content.innerHTML = ''; }
                if (btn) {
                    btn.setAttribute('aria-pressed', 'false');
                    btn.setAttribute('aria-expanded', 'false');
                    btn.classList.remove('active');
                    const listIcon = btn.querySelector('.feather-list');
                    const eyeOffIcon = btn.querySelector('.feather-eye-off');
                    if (listIcon) listIcon.style.display = 'inline';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'none';
                    const btnText = btn.querySelector('.uw-a11y-btn-text');
                    if (btnText) btnText.textContent = 'Show Alt Text List';
                }
                // Only hide the count pill if the overlay isn't also using it
                if (countEl && !this.isAltTextOverlayActive) countEl.style.display = 'none';
            }
            this.syncInspectorHubStatus();
            if (this.currentView === 'inspector') this.syncInspectorContentHeight();
        },

        // Render the list of image alt-text rows into the given container
        renderAltTextList: function(container, countEl) {
            const images = this.detectImages();

            if (!images.length) {
                container.innerHTML = '<p class="uw-a11y-outline-item"><span class="uw-a11y-outline-empty-text">No images found on this page.</span></p>';
                if (countEl) {
                    countEl.textContent = 'No images found';
                    countEl.style.color = '#6b7280';
                }
                return;
            }

            const warnSvg = `<svg fill="none" height="12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`;

            let issueCount = 0;
            const rows = images.map((img, idx) => {
                const hasIssue = img.issues.length > 0;
                if (hasIssue) issueCount++;
                const badge = this.getAltStatusBadge(img.status);

                let displayText;
                if (img.status === 'missing') {
                    displayText = `<span class="uw-a11y-link-name is-empty">(no alt attribute)</span>`;
                } else if (img.status === 'decorative' && !img.altText) {
                    const source = img.altSource ? ` — ${this.escapeHtmlContent(img.altSource)}` : '';
                    displayText = `<span class="uw-a11y-alt-decorative">Decorative${source}</span>`;
                } else if (img.status === 'empty') {
                    displayText = `<span class="uw-a11y-link-name is-empty">(no accessible name)</span>`;
                } else {
                    displayText = `<span class="uw-a11y-link-name">${this.escapeHtmlContent(img.altText)}</span>`;
                }

                const sourceHtml = img.altSource && img.status === 'has-alt' && img.altSource !== 'alt'
                    ? `<span class="uw-a11y-link-url">from ${this.escapeHtmlContent(img.altSource)}</span>`
                    : '';

                const typeHtml = `<span class="uw-a11y-link-url">&lt;${this.escapeHtmlContent(img.type)}&gt;</span>`;

                const issuesHtml = hasIssue
                    ? `<span class="uw-a11y-link-issues">${warnSvg}<span>${this.escapeHtmlContent(img.issues.join(' · '))}</span></span>`
                    : '';

                const titleText = this.escapeHtmlAttribute(
                    (img.altText ? `"${img.altText}"` : `Status: ${img.status}`) +
                    (img.altSource ? `\nSource: ${img.altSource}` : '') +
                    (hasIssue ? `\n\n${img.issues.join('\n')}` : '')
                );

                return `<button class="uw-a11y-link-row${hasIssue ? ' has-issue' : ''}" data-ai="${idx}" title="${titleText}">
                    <span class="uw-a11y-link-badge" style="background:${badge.bg};color:${badge.color};">${badge.label}</span>
                    <span class="uw-a11y-link-main">
                        ${displayText}
                        ${typeHtml}
                        ${sourceHtml}
                        ${issuesHtml}
                    </span>
                </button>`;
            }).join('');

            container.innerHTML = `<div class="uw-a11y-outline-list">${rows}</div>`;

            if (countEl) {
                countEl.textContent = issueCount > 0
                    ? `${images.length} image${images.length !== 1 ? 's' : ''} · ${issueCount} issue${issueCount !== 1 ? 's' : ''}`
                    : `${images.length} image${images.length !== 1 ? 's' : ''} · No issues`;
                countEl.style.color = issueCount > 0 ? '#b45309' : '#059669';
            }

            container.querySelectorAll('.uw-a11y-link-row[data-ai]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.ai, 10);
                    const target = images[idx] && images[idx].element;
                    this.scrollAndFlashTarget(target);
                });
            });
        },

        // Toggle the on-page alt-text overlay
        toggleAltTextOverlay: function() {
            const isActive = this.isAltTextOverlayActive || false;

            if (isActive) {
                this.hideAltTextOverlay();
            } else {
                this.showAltTextOverlay();
            }

            const btn = this.shadowRoot.getElementById('uw-a11y-alt-overlay-toggle');
            if (btn) {
                btn.setAttribute('aria-pressed', String(!isActive));
                const imageIcon = btn.querySelector('.feather-image');
                const eyeOffIcon = btn.querySelector('.feather-eye-off');
                const btnText = btn.querySelector('.uw-a11y-btn-text');

                if (!isActive) {
                    btn.classList.add('active');
                    if (imageIcon) imageIcon.style.display = 'none';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'inline';
                    if (btnText) btnText.textContent = 'Hide Alt Text Overlays';
                } else {
                    btn.classList.remove('active');
                    if (imageIcon) imageIcon.style.display = 'inline';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'none';
                    if (btnText) btnText.textContent = 'Show Alt Text Overlays';
                }
            }

            this.isAltTextOverlayActive = !isActive;
            this.syncInspectorHubStatus();
            if (this.currentView === 'inspector') this.syncInspectorContentHeight();
        },

        // Build the overlay and position a label above each image
        showAltTextOverlay: function() {
            this.hideAltTextOverlay();

            const images = this.detectImages();
            this.cachedAltImages = images;

            const overlay = document.createElement('div');
            overlay.className = 'uw-a11y-alt-overlay';
            overlay.setAttribute('data-uw-a11y-overlay', 'true');

            images.forEach((img, index) => {
                const indicator = this.createAltTextIndicator(img);
                if (indicator) {
                    indicator.style.animationDelay = `${Math.min(index * 15, 800)}ms`;
                    overlay.appendChild(indicator);
                }
            });

            document.body.appendChild(overlay);
            this.injectAltTextOverlayStyles();
            this.altTextOverlay = overlay;

            this.setupAltTextOverlayEventHandlers();

            // Share the same count pill as the list
            const countEl = this.shadowRoot.getElementById('uw-a11y-alt-count');
            if (countEl) {
                const issueCount = images.reduce((n, i) => n + (i.issues.length ? 1 : 0), 0);
                countEl.textContent = issueCount > 0
                    ? `${images.length} image${images.length !== 1 ? 's' : ''} · ${issueCount} issue${issueCount !== 1 ? 's' : ''}`
                    : `${images.length} image${images.length !== 1 ? 's' : ''} · No issues`;
                countEl.style.color = issueCount > 0 ? '#b45309' : '#059669';
                countEl.style.display = 'inline';
            }
        },

        hideAltTextOverlay: function() {
            if (this.altTextOverlay) {
                this.altTextOverlay.remove();
                this.altTextOverlay = null;
            }
            this.cachedAltImages = null;
            this.cleanupAltTextOverlayEventHandlers();

            // Only hide the count pill if the list isn't also open
            if (!this.isAltTextListActive) {
                const countEl = this.shadowRoot.getElementById('uw-a11y-alt-count');
                if (countEl) countEl.style.display = 'none';
            }

            // Also sweep up any orphaned overlays
            document.querySelectorAll('.uw-a11y-alt-overlay').forEach(o => o.remove());
        },

        // Create a label element for a single image's alt info
        createAltTextIndicator: function(img) {
            const rect = img.element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;

            const indicator = document.createElement('div');
            indicator.className = `uw-a11y-alt-indicator uw-a11y-alt-indicator--${img.status}`;
            if (img.issues.length) indicator.classList.add('has-issue');

            const x = rect.left + window.scrollX;
            const y = rect.top + window.scrollY;
            indicator.style.left = `${x}px`;
            indicator.style.top = `${y}px`;
            // Cap the label width by the image width when the image is wide, with a
            // sane floor so tiny icons still get a readable label.
            const maxWidth = Math.max(Math.min(rect.width, 360), 160);
            indicator.style.maxWidth = `${maxWidth}px`;

            const badge = this.getAltStatusBadge(img.status);

            let text;
            if (img.status === 'missing') {
                text = 'Missing alt attribute';
            } else if (img.status === 'decorative' && !img.altText) {
                text = `Decorative${img.altSource ? ` (${img.altSource})` : ''}`;
            } else if (img.status === 'empty') {
                text = 'No accessible name';
            } else {
                text = img.altText;
            }

            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'uw-a11y-alt-indicator-badge';
            badgeSpan.textContent = badge.label;
            badgeSpan.style.background = badge.bg;
            badgeSpan.style.color = badge.color;

            const textSpan = document.createElement('span');
            textSpan.className = 'uw-a11y-alt-indicator-text';
            textSpan.textContent = text;

            indicator.appendChild(badgeSpan);
            indicator.appendChild(textSpan);

            // Full text + any issues available via title (native tooltip)
            const tooltipParts = [text];
            if (img.altSource) tooltipParts.push(`Source: ${img.altSource}`);
            if (img.issues.length) tooltipParts.push('', ...img.issues);
            indicator.title = tooltipParts.join('\n');

            return indicator;
        },

        // Update indicator positions on scroll/resize using cached elements
        updateAltTextOverlayPositions: function() {
            if (!this.altTextOverlay || !this.cachedAltImages) return;
            const indicators = this.altTextOverlay.querySelectorAll('.uw-a11y-alt-indicator');
            indicators.forEach((indicator, index) => {
                const img = this.cachedAltImages[index];
                if (!img || !img.element || !img.element.isConnected) {
                    indicator.style.display = 'none';
                    return;
                }
                const rect = img.element.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    indicator.style.left = `${rect.left + window.scrollX}px`;
                    indicator.style.top = `${rect.top + window.scrollY}px`;
                    indicator.style.display = 'inline-flex';
                    const maxWidth = Math.max(Math.min(rect.width, 360), 160);
                    indicator.style.maxWidth = `${maxWidth}px`;
                } else {
                    indicator.style.display = 'none';
                }
            });
        },

        setupAltTextOverlayEventHandlers: function() {
            if (this.altTextOverlayScrollHandler || this.altTextOverlayResizeHandler) return;
            let scrolling = false;
            this.altTextOverlayScrollHandler = () => {
                if (scrolling || this.isAnimating) return;
                scrolling = true;
                requestAnimationFrame(() => {
                    if (!this.isAnimating) this.updateAltTextOverlayPositions();
                    scrolling = false;
                });
            };
            let resizeTimeout;
            this.altTextOverlayResizeHandler = () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    if (this.isAltTextOverlayActive) this.showAltTextOverlay();
                }, 100);
            };
            window.addEventListener('scroll', this.altTextOverlayScrollHandler, { passive: true });
            window.addEventListener('resize', this.altTextOverlayResizeHandler);
        },

        cleanupAltTextOverlayEventHandlers: function() {
            if (this.altTextOverlayScrollHandler) {
                window.removeEventListener('scroll', this.altTextOverlayScrollHandler);
                this.altTextOverlayScrollHandler = null;
            }
            if (this.altTextOverlayResizeHandler) {
                window.removeEventListener('resize', this.altTextOverlayResizeHandler);
                this.altTextOverlayResizeHandler = null;
            }
        },

        injectAltTextOverlayStyles: function() {
            if (document.getElementById('uw-a11y-alt-overlay-styles')) return;
            const styleEl = document.createElement('style');
            styleEl.id = 'uw-a11y-alt-overlay-styles';
            styleEl.textContent = `
                .uw-a11y-alt-overlay {
                    pointer-events: none;
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 999997;
                }
                .uw-a11y-alt-indicator {
                    position: absolute;
                    display: inline-flex;
                    align-items: flex-start;
                    gap: 6px;
                    padding: 5px 8px;
                    background: rgba(17, 24, 39, 0.92);
                    color: #f9fafb;
                    border-radius: 6px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                    font-size: 11px;
                    line-height: 1.35;
                    font-weight: 500;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
                    pointer-events: auto;
                    z-index: 999998;
                    animation: uw-alt-indicator-appear 0.3s ease-out both;
                    border-left: 3px solid #10b981;
                    max-width: 360px;
                    box-sizing: border-box;
                }
                .uw-a11y-alt-indicator--decorative { border-left-color: #3b82f6; }
                .uw-a11y-alt-indicator--missing,
                .uw-a11y-alt-indicator--empty { border-left-color: #ef4444; }
                .uw-a11y-alt-indicator.has-issue { border-left-color: #f59e0b; }
                .uw-a11y-alt-indicator-badge {
                    flex-shrink: 0;
                    font-size: 9px;
                    font-weight: 700;
                    letter-spacing: 0.04em;
                    padding: 1px 5px;
                    border-radius: 3px;
                    line-height: 1.5;
                }
                .uw-a11y-alt-indicator-text {
                    word-break: break-word;
                    overflow-wrap: anywhere;
                    display: -webkit-box;
                    -webkit-line-clamp: 3;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                }
                @keyframes uw-alt-indicator-appear {
                    0% { opacity: 0; transform: translateY(-4px); }
                    100% { opacity: 1; transform: translateY(0); }
                }
            `;
            document.head.appendChild(styleEl);
        },

        removeAltTextOverlayStyles: function() {
            const el = document.getElementById('uw-a11y-alt-overlay-styles');
            if (el) el.remove();
        },

        // Toggle tab order visualization
        toggleTabOrderVisualization: function() {
            const isActive = this.isTabOrderActive || false;
            
            if (isActive) {
                this.hideTabOrderVisualization();
            } else {
                this.showTabOrderVisualization();
            }
            
            // Update button state
            const tabOrderBtn = this.shadowRoot.getElementById('uw-a11y-tab-order-toggle');
            const tabOrderCount = this.shadowRoot.getElementById('uw-a11y-tab-order-count');
            
            if (tabOrderBtn) {
                tabOrderBtn.setAttribute('aria-pressed', String(!isActive));
                
                // Get the icons and text
                const moveIcon = tabOrderBtn.querySelector('.feather-move');
                const eyeOffIcon = tabOrderBtn.querySelector('.feather-eye-off');
                const btnText = tabOrderBtn.querySelector('.uw-a11y-btn-text');
                
                if (!isActive) {
                    // Activating tab order - show "Hide" state
                    tabOrderBtn.classList.add('active');
                    
                    // Switch icons
                    if (moveIcon) moveIcon.style.display = 'none';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'inline';
                    
                    // Update text
                    if (btnText) btnText.textContent = 'Hide Tab Order';
                } else {
                    // Deactivating tab order - show "Show" state
                    tabOrderBtn.classList.remove('active');
                    
                    // Switch icons
                    if (moveIcon) moveIcon.style.display = 'inline';
                    if (eyeOffIcon) eyeOffIcon.style.display = 'none';
                    
                    // Update text
                    if (btnText) btnText.textContent = 'Show Tab Order';
                }
                
                // Update count display
                if (tabOrderCount) {
                    if (!isActive) {
                        // Will be updated in showTabOrderVisualization
                        tabOrderCount.style.display = 'inline';
                    } else {
                        tabOrderCount.style.display = 'none';
                    }
                }
            }
            
            this.isTabOrderActive = !isActive;
        },

        // Show tab order visualization
        showTabOrderVisualization: function() {
            // Remove existing overlay if any
            this.hideTabOrderVisualization();
            
            // Get all focusable elements in the main document
            const focusableElements = this.getFocusableElements();
            
            // Cache focusable elements for scroll performance
            this.cachedFocusableElements = focusableElements;
            
            // Create overlay container
            const overlay = document.createElement('div');
            overlay.className = 'uw-a11y-tab-order-overlay';
            overlay.setAttribute('data-uw-a11y-overlay', 'true');

            // Create SVG layer for the connecting lines (sits below the numbered indicators)
            const svg = this.createTabOrderLineLayer(focusableElements);
            if (svg) overlay.appendChild(svg);

            // Add tab order indicators with staggered animation delay
            focusableElements.forEach((element, index) => {
                const indicator = this.createTabOrderIndicator(element, index + 1);
                if (indicator) {
                    // Add slight stagger to create a wave effect
                    const delay = Math.min(index * 20, 1000); // Max 1 second total delay
                    indicator.style.animationDelay = `${delay}ms`;
                    overlay.appendChild(indicator);
                }
            });
            
            // Add overlay to document body
            document.body.appendChild(overlay);
            
            // Ensure tab order styles are available in the main document
            this.injectTabOrderStyles();
            
            // Store reference to overlay
            this.tabOrderOverlay = overlay;
            
            // Set up mutation observer to update tab order when DOM changes
            this.setupTabOrderMutationObserver();
            
            // Set up scroll and resize handlers to update positions
            this.setupTabOrderEventHandlers();
            
            // Update count display
            const tabOrderCount = this.shadowRoot.getElementById('uw-a11y-tab-order-count');
            if (tabOrderCount) {
                tabOrderCount.textContent = `${focusableElements.length} focusable elements found`;
            }
            
            // Debug logging
            console.log(`Tab order visualization: ${focusableElements.length} focusable elements found`);
            console.log(`Created ${overlay.children.length} indicators`);
            
            // Log first few elements for debugging
            focusableElements.slice(0, 5).forEach((el, i) => {
                const rect = el.getBoundingClientRect();
                console.log(`Element ${i + 1}: ${el.tagName.toLowerCase()} at (${rect.left}, ${rect.top}) size: ${rect.width}x${rect.height}`);
            });
        },

        // Hide tab order visualization
        hideTabOrderVisualization: function() {
            if (this.tabOrderOverlay) {
                this.tabOrderOverlay.remove();
                this.tabOrderOverlay = null;
            }

            // Clear cached elements and line segment references
            this.cachedFocusableElements = null;
            this.tabOrderLineSegments = null;
            
            // Disconnect mutation observer
            if (this.tabOrderMutationObserver) {
                this.tabOrderMutationObserver.disconnect();
                this.tabOrderMutationObserver = null;
            }
            
            // Clean up event handlers
            this.cleanupTabOrderEventHandlers();
            
            // Also remove any orphaned overlays
            const existingOverlays = document.querySelectorAll('.uw-a11y-tab-order-overlay');
            existingOverlays.forEach(overlay => overlay.remove());
            
            // Remove injected styles
            this.removeTabOrderStyles();
        },

        // Set up mutation observer to refresh tab order when DOM changes
        setupTabOrderMutationObserver: function() {
            if (!this.isTabOrderActive || this.tabOrderMutationObserver) return;
            
            this.tabOrderMutationObserver = new MutationObserver((mutations) => {
                let shouldRefresh = false;
                
                mutations.forEach(mutation => {
                    // Check if any focusable elements were added or removed
                    if (mutation.type === 'childList') {
                        const hasRelevantChanges = Array.from(mutation.addedNodes)
                            .concat(Array.from(mutation.removedNodes))
                            .some(node => {
                                if (node.nodeType !== Node.ELEMENT_NODE) return false;
                                
                                // Skip changes within the accessibility checker
                                if (node.closest && (
                                    node.closest('[data-uw-a11y-overlay]') ||
                                    node.closest('uw-accessibility-checker') ||
                                    node.closest('#uw-a11y-panel')
                                )) {
                                    return false;
                                }
                                
                                // Check if the node or its children are focusable
                                return node.matches && (
                                    node.matches('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]') ||
                                    node.querySelector('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]')
                                );
                            });
                        
                        if (hasRelevantChanges) shouldRefresh = true;
                    }
                    
                    // Check for attribute changes that affect tabindex
                    if (mutation.type === 'attributes' && 
                        (mutation.attributeName === 'tabindex' || 
                         mutation.attributeName === 'disabled' ||
                         mutation.attributeName === 'hidden' ||
                         mutation.attributeName === 'style')) {
                        shouldRefresh = true;
                    }
                });
                
                if (shouldRefresh) {
                    // Debounce refreshes to avoid excessive updates
                    clearTimeout(this.tabOrderRefreshTimeout);
                    this.tabOrderRefreshTimeout = setTimeout(() => {
                        if (this.isTabOrderActive) {
                            this.showTabOrderVisualization();
                        }
                    }, 100);
                }
            });
            
            // Observe the entire document for changes
            this.tabOrderMutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['tabindex', 'disabled', 'hidden', 'style']
            });
        },

        // Set up event handlers for tab order visualization
        setupTabOrderEventHandlers: function() {
            if (this.tabOrderScrollHandler || this.tabOrderResizeHandler) return;
            
            // Throttled scroll handler with better performance
            let scrollTimeout;
            let isScrolling = false;
            
            this.tabOrderScrollHandler = () => {
                // Use requestAnimationFrame for smoother updates
                // Skip updates if panel animations are running to prevent conflicts
                if (!isScrolling && this.isTabOrderActive && !this.isAnimating) {
                    isScrolling = true;
                    requestAnimationFrame(() => {
                        // Double-check animation state before updating
                        if (!this.isAnimating) {
                            this.updateTabOrderPositions();
                        }
                        isScrolling = false;
                    });
                }
            };
            
            // Throttled resize handler
            let resizeTimeout;
            this.tabOrderResizeHandler = () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    if (this.isTabOrderActive) {
                        this.showTabOrderVisualization(); // Full refresh on resize
                    }
                }, 100);
            };
            
            window.addEventListener('scroll', this.tabOrderScrollHandler, { passive: true });
            window.addEventListener('resize', this.tabOrderResizeHandler);
        },

        // Clean up tab order event handlers
        cleanupTabOrderEventHandlers: function() {
            if (this.tabOrderScrollHandler) {
                window.removeEventListener('scroll', this.tabOrderScrollHandler);
                this.tabOrderScrollHandler = null;
            }
            if (this.tabOrderResizeHandler) {
                window.removeEventListener('resize', this.tabOrderResizeHandler);
                this.tabOrderResizeHandler = null;
            }
        },

        // Update positions of existing tab order indicators
        updateTabOrderPositions: function() {
            if (!this.tabOrderOverlay || !this.cachedFocusableElements) return;

            const indicators = this.tabOrderOverlay.querySelectorAll('.uw-a11y-tab-indicator');
            const visibility = new Array(this.cachedFocusableElements.length).fill(false);

            // Use cached elements to avoid expensive DOM queries on scroll
            indicators.forEach((indicator, index) => {
                const element = this.cachedFocusableElements[index];
                if (element && element.isConnected) { // Check if element still exists in DOM
                    const rect = element.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        const x = rect.left + window.scrollX;
                        const y = rect.top + window.scrollY;
                        indicator.style.left = `${x}px`;
                        indicator.style.top = `${y}px`;
                        indicator.style.display = 'flex';
                        visibility[index] = true;
                    } else {
                        indicator.style.display = 'none';
                    }
                } else {
                    indicator.style.display = 'none';
                }
            });

            // Refresh the connecting line segments to match current indicator positions
            this.updateTabOrderLineSegments(visibility);
        },

        // Update the SVG line segments connecting consecutive tab stops
        updateTabOrderLineSegments: function(visibility) {
            if (!this.tabOrderLineSegments || !this.cachedFocusableElements) return;

            const elements = this.cachedFocusableElements;
            const getCenter = (el) => {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return null;
                return { x: r.left + window.scrollX, y: r.top + window.scrollY };
            };

            this.tabOrderLineSegments.forEach((segment, i) => {
                const fromEl = elements[i];
                const toEl = elements[i + 1];
                const fromVisible = visibility ? visibility[i] : (fromEl && fromEl.isConnected);
                const toVisible = visibility ? visibility[i + 1] : (toEl && toEl.isConnected);

                if (!fromVisible || !toVisible) {
                    segment.setAttribute('display', 'none');
                    return;
                }

                const a = getCenter(fromEl);
                const b = getCenter(toEl);
                if (!a || !b) {
                    segment.setAttribute('display', 'none');
                    return;
                }

                segment.removeAttribute('display');
                segment.setAttribute('x1', a.x);
                segment.setAttribute('y1', a.y);
                segment.setAttribute('x2', b.x);
                segment.setAttribute('y2', b.y);
            });
        },

        // Get all focusable elements in the document
        getFocusableElements: function() {
            const focusableSelectors = [
                'a[href]',
                'button:not([disabled])',
                'input:not([disabled]):not([type="hidden"])',
                'select:not([disabled])',
                'textarea:not([disabled])',
                'audio[controls]',
                'video[controls]',
                'iframe',
                'object',
                'embed',
                'area[href]',
                'details > summary',
                '[tabindex]:not([tabindex="-1"])',
                '[contenteditable="true"]'
            ];
            
            const elements = Array.from(document.querySelectorAll(focusableSelectors.join(', ')));
            
            // Filter out elements that are not visible or are part of this accessibility checker
            return elements.filter(element => {
                // Skip elements inside the accessibility checker
                if (element.closest('[data-uw-a11y-overlay]') || 
                    element.closest('uw-accessibility-checker') ||
                    element.closest('#uw-a11y-panel')) {
                    return false;
                }
                
                // Skip invisible elements
                const style = window.getComputedStyle(element);
                if (style.display === 'none' || 
                    style.visibility === 'hidden' || 
                    style.opacity === '0') {
                    return false;
                }
                
                // Skip elements with negative tabindex (except -1 which we already excluded)
                const tabindex = element.getAttribute('tabindex');
                if (tabindex && parseInt(tabindex, 10) < 0) {
                    return false;
                }
                
                return true;
            }).sort((a, b) => {
                // Sort by tabindex, then by document order
                const aTabindex = parseInt(a.getAttribute('tabindex'), 10) || 0;
                const bTabindex = parseInt(b.getAttribute('tabindex'), 10) || 0;
                
                if (aTabindex !== bTabindex) {
                    // Elements with positive tabindex come first, in numerical order
                    if (aTabindex > 0 && bTabindex <= 0) return -1;
                    if (bTabindex > 0 && aTabindex <= 0) return 1;
                    if (aTabindex > 0 && bTabindex > 0) return aTabindex - bTabindex;
                }
                
                // For elements with same tabindex (including 0), use document order
                return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
            });
        },

        // Create a tab order indicator for an element
        createTabOrderIndicator: function(element, order) {
            const rect = element.getBoundingClientRect();
            
            // Skip elements that have no dimensions (truly hidden)
            if (rect.width === 0 || rect.height === 0) {
                return null;
            }
            
            const indicator = document.createElement('div');
            indicator.className = 'uw-a11y-tab-indicator';
            indicator.textContent = order;
            indicator.setAttribute('data-tab-order', order);
            indicator.setAttribute('data-element-tag', element.tagName.toLowerCase());
            
            // Position the indicator
            indicator.style.position = 'absolute';
            const x = rect.left + window.scrollX;
            const y = rect.top + window.scrollY;
            indicator.style.left = `${x}px`;
            indicator.style.top = `${y}px`;
            indicator.style.zIndex = '999999';
            
            // Add element info as title
            const elementInfo = this.getElementDescription(element);
            indicator.title = `Tab order ${order}: ${elementInfo}`;

            return indicator;
        },

        // Build an SVG layer with a line segment (with arrowhead) between each consecutive tab stop.
        // Stored segments are later updated in place by updateTabOrderLineSegments on scroll/resize.
        createTabOrderLineLayer: function(elements) {
            if (!elements || elements.length < 2) {
                this.tabOrderLineSegments = [];
                return null;
            }

            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('class', 'uw-a11y-tab-order-lines');
            svg.setAttribute('aria-hidden', 'true');
            svg.style.position = 'absolute';
            svg.style.top = '0';
            svg.style.left = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.overflow = 'visible';
            svg.style.pointerEvents = 'none';
            svg.style.zIndex = '999998';

            // Arrowhead marker so each segment shows direction of travel
            const defs = document.createElementNS(svgNS, 'defs');
            const marker = document.createElementNS(svgNS, 'marker');
            marker.setAttribute('id', 'uw-a11y-tab-order-arrow');
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '9');
            marker.setAttribute('refY', '5');
            marker.setAttribute('markerWidth', '5');
            marker.setAttribute('markerHeight', '5');
            marker.setAttribute('orient', 'auto-start-reverse');
            marker.setAttribute('markerUnits', 'strokeWidth');
            const arrowPath = document.createElementNS(svgNS, 'path');
            arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
            arrowPath.setAttribute('fill', '#ff6b35');
            marker.appendChild(arrowPath);
            defs.appendChild(marker);
            svg.appendChild(defs);

            const segments = [];
            for (let i = 0; i < elements.length - 1; i++) {
                const fromEl = elements[i];
                const toEl = elements[i + 1];
                const fromRect = fromEl.getBoundingClientRect();
                const toRect = toEl.getBoundingClientRect();
                const line = document.createElementNS(svgNS, 'line');
                line.setAttribute('class', 'uw-a11y-tab-order-line');
                line.setAttribute('stroke', '#ff6b35');
                line.setAttribute('stroke-width', '2');
                line.setAttribute('stroke-dasharray', '6 4');
                line.setAttribute('stroke-linecap', 'round');
                line.setAttribute('stroke-opacity', '0.75');
                line.setAttribute('marker-end', 'url(#uw-a11y-tab-order-arrow)');

                const fromVisible = fromRect.width > 0 && fromRect.height > 0;
                const toVisible = toRect.width > 0 && toRect.height > 0;
                if (fromVisible && toVisible) {
                    line.setAttribute('x1', fromRect.left + window.scrollX);
                    line.setAttribute('y1', fromRect.top + window.scrollY);
                    line.setAttribute('x2', toRect.left + window.scrollX);
                    line.setAttribute('y2', toRect.top + window.scrollY);
                } else {
                    line.setAttribute('display', 'none');
                }

                svg.appendChild(line);
                segments.push(line);
            }

            this.tabOrderLineSegments = segments;
            return svg;
        },

        // Inject tab order styles into the main document
        injectTabOrderStyles: function() {
            // Check if styles are already injected
            if (document.getElementById('uw-a11y-tab-order-styles')) {
                return;
            }
            
            const styleElement = document.createElement('style');
            styleElement.id = 'uw-a11y-tab-order-styles';
            styleElement.textContent = `
                .uw-a11y-tab-order-overlay {
                    pointer-events: none;
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 999998;
                }
                
                .uw-a11y-tab-order-lines {
                    animation: uw-tab-lines-appear 0.4s ease-out forwards;
                    opacity: 0;
                }

                @keyframes uw-tab-lines-appear {
                    0% { opacity: 0; }
                    100% { opacity: 1; }
                }

                .uw-a11y-tab-indicator {
                    position: absolute;
                    background: #ff6b35;
                    color: white;
                    border-radius: 50%;
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 14px;
                    font-weight: bold;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                    border: 3px solid white;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                    z-index: 999999;
                    pointer-events: none;
                    transform: translate(-50%, -50%);
                    animation: uw-tab-indicator-appear 0.3s ease-out forwards;
                    will-change: transform;
                    contain: layout style paint;
                    opacity: 0;
                }
                
                
                @keyframes uw-tab-indicator-appear {
                    0% {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.5);
                    }
                    100% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                }
            `;
            
            document.head.appendChild(styleElement);
        },

        // Remove tab order styles from the main document
        removeTabOrderStyles: function() {
            const styleElement = document.getElementById('uw-a11y-tab-order-styles');
            if (styleElement) {
                styleElement.remove();
            }
        },

        // Get a description of an element for accessibility
        getElementDescription: function(element) {
            const tag = element.tagName.toLowerCase();
            const type = element.type || '';
            const text = element.textContent?.trim().substring(0, 50) || '';
            const ariaLabel = element.getAttribute('aria-label') || '';
            const altText = element.getAttribute('alt') || '';
            const href = element.getAttribute('href') || '';
            
            let description = tag;
            
            if (type) description += `[${type}]`;
            if (ariaLabel) description += ` "${ariaLabel}"`;
            else if (altText) description += ` "${altText}"`;
            else if (text) description += ` "${text}"`;
            else if (href) description += ` href="${href.substring(0, 30)}"`;
            
            return description;
        },

        resetSettingsToDefaults: function() {
            const defaults = {
                excludeSelectors: this.getDefaultExcludeSelectors(),
                includeSelectors: [],
                enableBestPractices: true,
                ...this.getDefaultWcag()
            };
            this.saveSettings(defaults);
            return defaults;
        },

        // Render the Settings view (called after panel creation)
        renderSettings: function() {
            const wrap = this.shadowRoot.getElementById('uw-a11y-view-settings');
            if (!wrap) return;

            const settings = this.loadSettings();
            // Show only user-adjustable selectors in the input (strip essentials)
            const renderList = Array.isArray(settings.excludeSelectors) ? settings.excludeSelectors : this.getDefaultExcludeSelectors();
            const current = this.filterOutEssential(renderList).join(', ');
            const includeList = Array.isArray(settings.includeSelectors) ? settings.includeSelectors : [];
            const currentInclude = includeList.join(', ');
            const bp = settings.enableBestPractices !== false; // default true
            const wcag = { ...(this.getDefaultWcag()), wcagSpec: settings.wcagSpec || '2.1', wcagLevel: (settings.wcagLevel || 'AA').toUpperCase() };

            wrap.innerHTML = `
                <div class="uw-a11y-settings" role="region" aria-labelledby="uw-a11y-settings-heading">
                    <h3 id="uw-a11y-settings-heading">Settings</h3>

                    <p class="uw-a11y-section-divider">Accessibility</p>

                    <div class="uw-a11y-setting-card">
                        <div class="uw-a11y-settings-2col">
                            <div>
                                <label for="uw-a11y-wcag-spec" class="uw-a11y-setting-label">WCAG Version</label>
                                <select id="uw-a11y-wcag-spec" class="uw-a11y-input">
                                    <option value="2.0" ${wcag.wcagSpec==='2.0'?'selected':''}>WCAG 2.0</option>
                                    <option value="2.1" ${wcag.wcagSpec==='2.1'?'selected':''}>WCAG 2.1</option>
                                    <option value="2.2" ${wcag.wcagSpec==='2.2'?'selected':''}>WCAG 2.2</option>
                                </select>
                            </div>
                            <div>
                                <label for="uw-a11y-wcag-level" class="uw-a11y-setting-label">Conformance Level</label>
                                <select id="uw-a11y-wcag-level" class="uw-a11y-input">
                                    <option value="A" ${wcag.wcagLevel==='A'?'selected':''}>Level A</option>
                                    <option value="AA" ${wcag.wcagLevel==='AA'?'selected':''}>Level AA</option>
                                    <option value="AAA" ${wcag.wcagLevel==='AAA'?'selected':''}>Level AAA</option>
                                </select>
                            </div>
                        </div>
                        <div class="uw-a11y-helptext">Default is WCAG 2.1 AA. Level AAA enables enhanced color contrast rules.</div>
                    </div>

                    <div class="uw-a11y-pref-row">
                        <div class="uw-a11y-pref-label">
                            <strong>Best Practice Suggestions</strong>
                            <span>Tips beyond WCAG failures — link text clarity, new‑tab labeling, and more.</span>
                        </div>
                        <label class="uw-a11y-toggle" aria-label="Include best practice suggestions">
                            <input id="uw-a11y-bp-input" type="checkbox" ${bp ? 'checked' : ''}>
                            <span class="uw-a11y-toggle-slider"></span>
                        </label>
                    </div>

                    <p class="uw-a11y-section-divider">Scanning</p>

                    <div class="uw-a11y-setting-card">
                        <div class="uw-a11y-settings-2col">
                            <div>
                                <label for="uw-a11y-platform-preset" class="uw-a11y-setting-label">Platform Preset</label>
                                <select id="uw-a11y-platform-preset" class="uw-a11y-input" aria-describedby="uw-a11y-platform-preset-help">
                                    <option value="">No preset</option>
                                    ${Object.entries(this.getPlatformPresets()).map(([key, p]) => {
                                        const sel = this.getActivePresetForCurrentHost() === key ? ' selected' : '';
                                        return `<option value="${this.escapeHtmlAttr(key)}"${sel}>${this.escapeHtmlContent(p.label)}</option>`;
                                    }).join('')}
                                </select>
                            </div>
                            <div>
                                <label for="uw-a11y-scan-mode" class="uw-a11y-setting-label">Scan Mode</label>
                                <select id="uw-a11y-scan-mode" class="uw-a11y-input" aria-describedby="uw-a11y-platform-preset-help" ${this.getActivePresetForCurrentHost() ? '' : 'disabled'}>
                                    <option value="whole" ${this.getActivePresetModeForCurrentHost() === 'whole' ? 'selected' : ''}>Whole page</option>
                                    <option value="content" ${this.getActivePresetModeForCurrentHost() === 'content' ? 'selected' : ''}>Just the content</option>
                                </select>
                            </div>
                        </div>
                        <div id="uw-a11y-platform-preset-help" class="uw-a11y-helptext" style="margin-top:6px;">
                            Adjusts <strong>Scan Scope</strong> and <strong>Exclude Selectors</strong> for the current site. <strong>Just the content</strong> further limits the scan to the preset's content area — useful if you only manage page content and not the theme. Remembered per&#8209;hostname (<code>${this.escapeHtmlContent(this.getCurrentHostname() || '(unknown)')}</code>). Re&#8209;scans automatically.
                        </div>
                        <div id="uw-a11y-platform-preset-active" class="uw-a11y-helptext" style="margin-top:4px;display:${this.getActivePresetForCurrentHost() ? 'block' : 'none'};color:#198754;"></div>
                    </div>

                    <div class="uw-a11y-setting-card">
                        <label for="uw-a11y-include-input" class="uw-a11y-setting-label">Scan Scope</label>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <div style="position:relative;flex:1;min-width:0;">
                                <input id="uw-a11y-include-input" class="uw-a11y-input" type="text"
                                    value="${this.escapeHtmlAttr(currentInclude)}"
                                    aria-describedby="uw-a11y-include-help"
                                    placeholder="e.g. #main, .content-area"
                                    style="width:100%;padding-right:${currentInclude ? '28px' : ''};">
                                <button id="uw-a11y-clear-scope" type="button"
                                    aria-label="Clear scan scope"
                                    title="Clear scan scope"
                                    style="display:${currentInclude ? 'flex' : 'none'};position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;padding:2px;cursor:pointer;color:#888;align-items:center;justify-content:center;border-radius:3px;line-height:1;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                            </div>
                            <button id="uw-a11y-pick-element" class="uw-a11y-btn uw-a11y-btn-secondary"
                                type="button" title="Click elements on the page to add their selectors"
                                style="white-space:nowrap;flex-shrink:0;">
                                Pick element
                            </button>
                        </div>
                        <div id="uw-a11y-include-help" class="uw-a11y-helptext">Comma&#8209;separated CSS selectors. When set, only these elements are scanned. Leave empty to scan the whole page.</div>
                    </div>

                    <div class="uw-a11y-setting-card">
                        <label for="uw-a11y-exclude-input" class="uw-a11y-setting-label">Exclude Selectors</label>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <div style="position:relative;flex:1;min-width:0;">
                                <input id="uw-a11y-exclude-input" class="uw-a11y-input" type="text"
                                    value="${this.escapeHtmlAttr(current)}"
                                    aria-describedby="uw-a11y-exclude-help"
                                    placeholder="e.g. .my-widget, #sidebar"
                                    style="width:100%;padding-right:${current ? '28px' : ''};">
                                <button id="uw-a11y-clear-exclude" type="button"
                                    aria-label="Clear exclude selectors"
                                    title="Clear exclude selectors"
                                    style="display:${current ? 'flex' : 'none'};position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;padding:2px;cursor:pointer;color:#888;align-items:center;justify-content:center;border-radius:3px;line-height:1;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                            </div>
                            <button id="uw-a11y-pick-exclude-element" class="uw-a11y-btn uw-a11y-btn-secondary"
                                type="button" title="Click elements on the page to exclude them from scanning"
                                style="white-space:nowrap;flex-shrink:0;">
                                Pick element
                            </button>
                        </div>
                        <div id="uw-a11y-exclude-help" class="uw-a11y-helptext">Comma‑separated CSS selectors skipped during scanning. Essential internal UI is always excluded.</div>
                    </div>

                    <p class="uw-a11y-section-divider">Interface</p>

                    <div class="uw-a11y-pref-row">
                        <div class="uw-a11y-pref-label">
                            <strong>Dock to right side</strong>
                            <span>Pin the panel to the right edge full-height. Page content shifts to make room. Off by default — the panel floats and is draggable.</span>
                        </div>
                        <label class="uw-a11y-toggle" aria-label="Dock panel to right side">
                            <input id="uw-a11y-dock-toggle" type="checkbox" ${this.getDockPosition() === 'right' ? 'checked' : ''}>
                            <span class="uw-a11y-toggle-slider"></span>
                        </label>
                    </div>

                    <div class="uw-a11y-pref-row">
                        <div class="uw-a11y-pref-label">
                            <strong>Default to advanced view</strong>
                            <span>Skip the curated "Top things to fix" landing and open straight to the full filterable list of every finding.</span>
                        </div>
                        <label class="uw-a11y-toggle" aria-label="Default to advanced results view">
                            <input id="uw-a11y-default-advanced-toggle" type="checkbox" ${this.getDefaultResultsView() === 'advanced' ? 'checked' : ''}>
                            <span class="uw-a11y-toggle-slider"></span>
                        </label>
                    </div>

                    <div class="uw-a11y-pref-row">
                        <div class="uw-a11y-pref-label">
                            <strong>UI Sounds</strong>
                            <span>Subtle audio cues on scan complete, navigation, and interactions.</span>
                        </div>
                        <label class="uw-a11y-toggle" aria-label="Enable UI sounds">
                            <input id="uw-a11y-sounds-toggle" type="checkbox" ${localStorage.getItem('uw-a11y-sounds') !== 'off' ? 'checked' : ''}>
                            <span class="uw-a11y-toggle-slider"></span>
                        </label>
                    </div>

                    <div class="uw-a11y-setting-card">
                        <div class="uw-a11y-setting-label">Issue Highlight</div>
                        <div class="uw-a11y-helptext" style="margin-bottom:10px;">How elements look when you click an issue, and how long the highlight stays.</div>
                        <div class="uw-a11y-settings-2col">
                            <div>
                                <label for="uw-a11y-highlight-style" class="uw-a11y-setting-label">Style</label>
                                <select id="uw-a11y-highlight-style" class="uw-a11y-input">
                                    ${Object.entries(this.getHighlightStylePresets()).map(([key, p]) => {
                                        const sel = this.getHighlightStyle() === key ? ' selected' : '';
                                        return `<option value="${this.escapeHtmlAttr(key)}"${sel}>${this.escapeHtmlContent(p.label)}</option>`;
                                    }).join('')}
                                </select>
                            </div>
                            <div>
                                <label for="uw-a11y-highlight-duration" class="uw-a11y-setting-label">Duration</label>
                                <select id="uw-a11y-highlight-duration" class="uw-a11y-input">
                                    ${this.getHighlightDurationOptions().map(o => {
                                        const sel = this.getHighlightDuration() === o.value ? ' selected' : '';
                                        return `<option value="${o.value}"${sel}>${this.escapeHtmlContent(o.label)}</option>`;
                                    }).join('')}
                                </select>
                            </div>
                        </div>
                    </div>

                    <p class="uw-a11y-section-divider">Results</p>

                    <div class="uw-a11y-setting-card">
                        <div class="uw-a11y-setting-label">Dismissed Issues</div>
                        <div class="uw-a11y-helptext" style="margin-bottom:10px;">Issues you've dismissed are hidden from results and remembered across sessions.</div>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <span id="uw-a11y-dismissed-count" style="font-size:13px;color:#555;"></span>
                            <button id="uw-a11y-clear-dismissed" class="uw-a11y-btn uw-a11y-btn-secondary" style="font-size:12px;padding:4px 10px;" hidden
                                data-uw-action="clearDismissedIssues">Restore all dismissed</button>
                        </div>
                    </div>

                    <p class="uw-a11y-section-divider">History</p>

                    <div class="uw-a11y-pref-row">
                        <div class="uw-a11y-pref-label">
                            <strong>Track score history for this site</strong>
                            <span>Save each scan locally so you can chart accessibility trends over time. Stored only in this browser, scoped to the URL path.</span>
                        </div>
                        <label class="uw-a11y-toggle" aria-label="Track score history for this site">
                            <input id="uw-a11y-history-toggle" type="checkbox" ${this.isHistoryTrackingEnabled() ? 'checked' : ''}>
                            <span class="uw-a11y-toggle-slider"></span>
                        </label>
                    </div>

                    <div class="uw-a11y-setting-card">
                        <div class="uw-a11y-setting-label">Stored history</div>
                        <div class="uw-a11y-helptext" style="margin-bottom:10px;" id="uw-a11y-history-summary">Calculating…</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                            <button id="uw-a11y-clear-history-url" class="uw-a11y-btn uw-a11y-btn-secondary" style="font-size:12px;padding:4px 10px;">Clear history for this URL</button>
                            <button id="uw-a11y-clear-history-all" class="uw-a11y-btn uw-a11y-btn-secondary" style="font-size:12px;padding:4px 10px;">Clear all history</button>
                            <a href="#" id="uw-a11y-open-history" class="uw-a11y-btn uw-a11y-btn-secondary" style="font-size:12px;padding:4px 10px;text-decoration:none;">Open history view</a>
                        </div>
                    </div>
                </div>
                <!-- Docked footer: appears only when scan settings have been changed -->
                <div id="uw-a11y-actions-bar" class="uw-a11y-actions-bar" hidden>
                    <button id="uw-a11y-save-settings" class="uw-a11y-btn primary">Save and Re‑scan</button>
                    <button id="uw-a11y-reset-settings" class="uw-a11y-btn" title="Reset to defaults">
                        <svg class="uw-a11y-reset-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>
                        Reset
                    </button>
                    <div id="uw-a11y-settings-msg" class="uw-a11y-msg" aria-live="polite"></div>
                </div>
            `;

            const input = this.shadowRoot.getElementById('uw-a11y-exclude-input');
            const includeInput = this.shadowRoot.getElementById('uw-a11y-include-input');
            const pickBtn = this.shadowRoot.getElementById('uw-a11y-pick-element');
            const clearScopeBtn = this.shadowRoot.getElementById('uw-a11y-clear-scope');
            const msg = this.shadowRoot.getElementById('uw-a11y-settings-msg');
            const actionsBar = this.shadowRoot.getElementById('uw-a11y-actions-bar');
            const saveBtn = this.shadowRoot.getElementById('uw-a11y-save-settings');
            const resetBtn = this.shadowRoot.getElementById('uw-a11y-reset-settings');
            const bpInput = this.shadowRoot.getElementById('uw-a11y-bp-input');
            const wcagSpecSel = this.shadowRoot.getElementById('uw-a11y-wcag-spec');
            const wcagLevelSel = this.shadowRoot.getElementById('uw-a11y-wcag-level');
            const soundsToggle = this.shadowRoot.getElementById('uw-a11y-sounds-toggle');
            const pickExcludeBtn = this.shadowRoot.getElementById('uw-a11y-pick-exclude-element');
            const clearExcludeBtn = this.shadowRoot.getElementById('uw-a11y-clear-exclude');
            const platformPreset = this.shadowRoot.getElementById('uw-a11y-platform-preset');
            const scanModeSelect = this.shadowRoot.getElementById('uw-a11y-scan-mode');

            // Snapshot values at render time for dirty comparison. Platform
            // preset + scan mode are also tracked here so changing them only
            // *previews* the choice in the form; nothing is written to the
            // host-preset map or re-scanned until Save and Re-scan is clicked.
            const snap = () => ({
                exclude: input.value,
                include: includeInput.value,
                wcagSpec: wcagSpecSel.value,
                wcagLevel: wcagLevelSel.value,
                bp: bpInput.checked,
                preset: platformPreset ? platformPreset.value : '',
                scanMode: scanModeSelect ? scanModeSelect.value : 'whole'
            });
            let initialValues = snap();

            // Show/hide the save bar based on whether anything changed
            const checkDirty = () => {
                const now = snap();
                const dirty = now.exclude !== initialValues.exclude
                    || now.include !== initialValues.include
                    || now.wcagSpec !== initialValues.wcagSpec
                    || now.wcagLevel !== initialValues.wcagLevel
                    || now.bp !== initialValues.bp
                    || now.preset !== initialValues.preset
                    || now.scanMode !== initialValues.scanMode;
                actionsBar.hidden = !dirty;
                if (!dirty && msg) msg.textContent = '';
            };

            input.addEventListener('input', checkDirty);
            includeInput.addEventListener('input', checkDirty);
            wcagSpecSel.addEventListener('change', checkDirty);
            wcagLevelSel.addEventListener('change', checkDirty);
            bpInput.addEventListener('change', checkDirty);

            if (pickBtn) {
                pickBtn.addEventListener('click', () => this.startPickerMode(includeInput));
            }

            // Show/hide the X button as the include input changes; update padding so text doesn't overlap it
            const updateClearBtn = () => {
                const hasValue = includeInput.value.trim().length > 0;
                if (clearScopeBtn) {
                    clearScopeBtn.style.display = hasValue ? 'flex' : 'none';
                }
                includeInput.style.paddingRight = hasValue ? '28px' : '';
            };
            includeInput.addEventListener('input', updateClearBtn);

            if (clearScopeBtn) {
                clearScopeBtn.addEventListener('click', () => {
                    includeInput.value = '';
                    // Remove any picker-injected data-pinpoint-scope attributes
                    document.querySelectorAll('[data-pinpoint-scope]').forEach(el => {
                        el.removeAttribute('data-pinpoint-scope');
                    });
                    updateClearBtn();
                    checkDirty();
                    this.playSound('ui');
                    includeInput.focus();
                });
            }

            // ── Exclude selectors: Pick element, Clear, and Platform Preset ──

            if (pickExcludeBtn) {
                pickExcludeBtn.addEventListener('click', () => this.startPickerMode(input));
            }

            // Show/hide the X button as the exclude input changes
            const updateClearExcludeBtn = () => {
                const hasValue = input.value.trim().length > 0;
                if (clearExcludeBtn) {
                    clearExcludeBtn.style.display = hasValue ? 'flex' : 'none';
                }
                input.style.paddingRight = hasValue ? '28px' : '';
            };
            input.addEventListener('input', updateClearExcludeBtn);

            if (clearExcludeBtn) {
                clearExcludeBtn.addEventListener('click', () => {
                    input.value = '';
                    updateClearExcludeBtn();
                    checkDirty();
                    this.playSound('ui');
                    input.focus();
                });
            }

            // Platform preset + Scan Mode dropdowns. Selecting a preset and/or
            // mode only previews the choice — both go into the dirty snapshot
            // and are committed together when the user clicks Save and Re-scan
            // below. This lets you pick (e.g.) WordPress + "just the content"
            // in a single round-trip rather than triggering two scans.
            const presetActiveLabel = this.shadowRoot.getElementById('uw-a11y-platform-preset-active');
            const renderPresetActiveLabel = () => {
                if (!presetActiveLabel) return;
                const name = this.getActivePresetForCurrentHost();
                if (!name) {
                    presetActiveLabel.style.display = 'none';
                    presetActiveLabel.textContent = '';
                    return;
                }
                const preset = this.getPlatformPresets()[name];
                const mode = this.getActivePresetModeForCurrentHost();
                const effectiveScope = this.getActivePresetSelectors().scope.join(', ');
                const parts = [];
                if (effectiveScope)  parts.push(`adds <code>${this.escapeHtmlContent(effectiveScope)}</code> to scan scope`);
                if (preset.exclude)  parts.push(`adds <code>${this.escapeHtmlContent(preset.exclude)}</code> to excludes`);
                const modeLabel = mode === 'content' ? ' · just the content' : '';
                presetActiveLabel.style.display = 'block';
                presetActiveLabel.innerHTML = `✓ <strong>${this.escapeHtmlContent(preset.label)}</strong>${modeLabel} active for <code>${this.escapeHtmlContent(this.getCurrentHostname())}</code> — ${parts.join('; ') || 'no additional selectors'}.`;
            };
            renderPresetActiveLabel();

            if (platformPreset) {
                platformPreset.addEventListener('change', () => {
                    // Toggle Scan Mode availability based on preset selection;
                    // when no preset is picked, "just the content" has nothing
                    // to act on. Clearing the preset also normalizes mode back
                    // to "whole" so the dirty snapshot doesn't leave a
                    // mismatched mode behind.
                    if (scanModeSelect) {
                        scanModeSelect.disabled = !platformPreset.value;
                        if (!platformPreset.value) scanModeSelect.value = 'whole';
                    }
                    this.playSound('ui');
                    checkDirty();
                });
            }

            if (scanModeSelect) {
                scanModeSelect.addEventListener('change', () => {
                    if (!platformPreset || !platformPreset.value) return;
                    this.playSound('ui');
                    checkDirty();
                });
            }

            // Sound toggle — saves instantly to localStorage, no re-scan needed
            if (soundsToggle) {
                soundsToggle.addEventListener('change', () => {
                    if (soundsToggle.checked) {
                        localStorage.removeItem('uw-a11y-sounds');
                        this.playSound('verify');
                    } else {
                        localStorage.setItem('uw-a11y-sounds', 'off');
                    }
                });
            }

            // Highlight style + duration — apply instantly, no re-scan needed
            const hlStyleSel = this.shadowRoot.getElementById('uw-a11y-highlight-style');
            if (hlStyleSel) {
                hlStyleSel.addEventListener('change', () => {
                    this.setHighlightStyle(hlStyleSel.value);
                    this.playSound('ui');
                });
            }
            const hlDurationSel = this.shadowRoot.getElementById('uw-a11y-highlight-duration');
            if (hlDurationSel) {
                hlDurationSel.addEventListener('change', () => {
                    this.setHighlightDuration(parseInt(hlDurationSel.value, 10));
                    this.playSound('ui');
                });
            }

            // Dock toggle — applies instantly, no re-scan needed
            const dockToggle = this.shadowRoot.getElementById('uw-a11y-dock-toggle');
            if (dockToggle) {
                dockToggle.addEventListener('change', () => {
                    this.setDockPosition(dockToggle.checked ? 'right' : 'floating');
                    this.playSound('ui');
                });
            }

            // Default-to-advanced toggle — saves preference, takes effect on next scan
            // (or when results panel re-renders).
            const defaultAdvToggle = this.shadowRoot.getElementById('uw-a11y-default-advanced-toggle');
            if (defaultAdvToggle) {
                defaultAdvToggle.addEventListener('change', () => {
                    this.setDefaultResultsView(defaultAdvToggle.checked ? 'advanced' : 'guided');
                    this.playSound('ui');
                });
            }

            // History tracking toggle + Clear buttons
            const historyToggle = this.shadowRoot.getElementById('uw-a11y-history-toggle');
            const clearHistUrlBtn = this.shadowRoot.getElementById('uw-a11y-clear-history-url');
            const clearHistAllBtn = this.shadowRoot.getElementById('uw-a11y-clear-history-all');
            const openHistoryLink = this.shadowRoot.getElementById('uw-a11y-open-history');
            const historySummary = this.shadowRoot.getElementById('uw-a11y-history-summary');

            const refreshHistorySummary = () => {
                if (!historySummary) return;
                const all = this.loadHistoryAll();
                const urls = Object.keys(all);
                const total = urls.reduce((s, k) => s + (Array.isArray(all[k]) ? all[k].length : 0), 0);
                const here = (all[this.getCurrentHistoryBucketKey()] || []).length;
                historySummary.textContent = `${here} scan${here === 1 ? '' : 's'} on this URL · ${total} scan${total === 1 ? '' : 's'} across ${urls.length} URL${urls.length === 1 ? '' : 's'} on this site.`;
            };
            refreshHistorySummary();

            if (historyToggle) {
                historyToggle.addEventListener('change', () => {
                    this.setHistoryTrackingEnabled(historyToggle.checked);
                    this.playSound('ui');
                    this.renderHistoryView();
                });
            }

            // Two-step confirm for clear buttons (label flips to "Click again to confirm")
            const armConfirm = (btn, action) => {
                if (!btn) return;
                btn.addEventListener('click', () => {
                    if (btn.dataset.confirming) {
                        delete btn.dataset.confirming;
                        action();
                        refreshHistorySummary();
                        return;
                    }
                    btn.dataset.confirming = '1';
                    const orig = btn.textContent;
                    btn.dataset.origText = orig;
                    btn.textContent = 'Click again to confirm';
                    btn.classList.add('uw-a11y-dismiss-btn--confirming');
                    setTimeout(() => {
                        if (btn.isConnected && btn.dataset.confirming) {
                            delete btn.dataset.confirming;
                            btn.textContent = btn.dataset.origText || orig;
                            btn.classList.remove('uw-a11y-dismiss-btn--confirming');
                        }
                    }, 4000);
                });
            };
            armConfirm(clearHistUrlBtn, () => this.clearHistoryForCurrentUrl());
            armConfirm(clearHistAllBtn, () => this.clearAllHistory());

            if (openHistoryLink) {
                openHistoryLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showView('history');
                });
            }

            const parseSelectors = (val) => val.split(',').map(s => s.trim()).filter(Boolean);
            const validateSelectors = (arr) => {
                for (const sel of arr) {
                    try { document.querySelectorAll(sel); } catch (e) { return sel; }
                }
                return null;
            };

            saveBtn.addEventListener('click', () => {
                const arr = parseSelectors(input.value || '');
                const bad = validateSelectors(arr);
                if (bad) {
                    msg.textContent = `Invalid selector: ${bad}`;
                    msg.className = 'uw-a11y-msg err';
                    return;
                }
                const includeArr = [...new Set(parseSelectors(includeInput.value || ''))];
                const badInclude = validateSelectors(includeArr);
                if (badInclude) {
                    msg.textContent = `Invalid scope selector: ${badInclude}`;
                    msg.className = 'uw-a11y-msg err';
                    return;
                }
                // Merge into the existing settings rather than overwriting —
                // otherwise unrelated keys (trackHistory, dockPosition,
                // defaultResultsView) get wiped by Save and Re-scan.
                const existing = this.loadSettings();
                const toSave = {
                    ...existing,
                    excludeSelectors: this.filterOutEssential(arr),
                    includeSelectors: includeArr,
                    enableBestPractices: !!(bpInput && bpInput.checked),
                    wcagSpec: wcagSpecSel ? wcagSpecSel.value : '2.1',
                    wcagLevel: wcagLevelSel ? wcagLevelSel.value : 'AA'
                };
                this.saveSettings(toSave);
                // Drop any stored picker-scope fallback whose scope id is no
                // longer present in the include list.
                const keptIds = new Set(
                    includeArr
                        .map(sel => (sel.match(/^\[data-pinpoint-scope="(pp-\d+)"\]$/) || [])[1])
                        .filter(Boolean)
                );
                const fallbacks = this.getPickerScopeFallbacks();
                const pruned = {};
                Object.keys(fallbacks).forEach(id => {
                    if (keptIds.has(id)) pruned[id] = fallbacks[id];
                });
                this.savePickerScopeFallbacks(pruned);
                // Commit the platform preset + scan mode picks for this host.
                // Done as part of Save and Re-scan so the user can stage both
                // (preset and mode) before triggering a single re-scan.
                const pendingPreset = platformPreset ? platformPreset.value : '';
                const pendingMode = scanModeSelect ? scanModeSelect.value : 'whole';
                this.setActivePresetForCurrentHost(pendingPreset, pendingMode);
                renderPresetActiveLabel();
                // Update snapshot so bar hides after save
                initialValues = snap();
                actionsBar.hidden = true;
                this.scoreAnimationPlayed = false;
                // Refresh the help section so its WCAG filter reflects the new level
                this.renderHelp();
                this.runAxeChecks();
                this.showView('results');
            });

            resetBtn.addEventListener('click', () => {
                const defaults = this.resetSettingsToDefaults();
                input.value = this.filterOutEssential(defaults.excludeSelectors).join(', ');
                if (includeInput) includeInput.value = '';
                if (bpInput) bpInput.checked = !!defaults.enableBestPractices;
                if (wcagSpecSel) wcagSpecSel.value = defaults.wcagSpec;
                if (wcagLevelSel) wcagLevelSel.value = defaults.wcagLevel;
                // Reset the platform preset + scan mode UI back to whatever
                // is currently saved for this host. (We don't clear the
                // host-preset record on reset — Reset is for "restore my
                // tweaks", not "wipe all per-host memory".)
                if (platformPreset) platformPreset.value = this.getActivePresetForCurrentHost() || '';
                if (scanModeSelect) {
                    scanModeSelect.value = this.getActivePresetModeForCurrentHost();
                    scanModeSelect.disabled = !platformPreset || !platformPreset.value;
                }
                updateClearBtn();
                updateClearExcludeBtn();
                // Update snapshot to match restored defaults → hides bar
                initialValues = snap();
                actionsBar.hidden = true;
                if (msg) { msg.textContent = 'Reset to defaults.'; msg.className = 'uw-a11y-msg ok'; }
                // Refresh help so its WCAG filter follows the reset level
                this.renderHelp();
            });

            // Populate dismissed count immediately
            this.updateDismissedCount();

        },

        // Remove essential/selectors from a provided list
        filterOutEssential: function(list) {
            const essentials = new Set(this.getEssentialExcludeSelectors());
            return (list || []).filter(sel => !essentials.has(sel));
        },

        // ── Help System ────────────────────────────────────────────────────────

        getHelpTopics: function() {
            return [
                // ─── Using Pinpoint ───
                { id: 'help-getting-started', cat: 'tool', title: 'Getting Started',
                  keys: 'getting started run scan check begin how to use quick start',
                  body: '<p>Click the Pinpoint icon in your browser toolbar to launch the checker on any page. It automatically runs an accessibility scan and displays results organized by severity.</p><ul><li><strong>Errors</strong> — WCAG violations that must be fixed.</li><li><strong>Warnings</strong> — Issues that need manual review.</li><li><strong>Best Practices</strong> — Suggestions beyond the WCAG spec.</li></ul><p>Click any result to highlight the offending element on the page and see a recommended fix.</p>' },
                { id: 'help-results', cat: 'tool', title: 'Understanding Results',
                  keys: 'results issues errors warnings best practices score impact severity count badge',
                  body: '<p>Results are grouped by rule. Each group shows how many instances were found and the impact level: <strong>critical</strong>, <strong>serious</strong>, <strong>moderate</strong>, or <strong>minor</strong>.</p><ul><li>Click a group to expand it and see every affected element.</li><li>Click an individual instance to scroll to and highlight the element on the page.</li><li>Use the <strong>eye icons</strong> in the category headers to show or hide entire categories (errors, warnings, best practices).</li></ul><p>The accessibility score at the top gives a quick overall picture. A higher score means fewer issues relative to total elements checked.</p>' },
                { id: 'help-inspector', cat: 'tool', title: 'Inspector',
                  keys: 'inspector inspect element details dom node attributes accessibility tree',
                  body: '<p>The Inspector view lets you examine individual elements and their accessibility properties. Click any element on the page while the Inspector is active to see:</p><ul><li>The element\'s accessible name and role</li><li>ARIA attributes and states</li><li>Color contrast information</li><li>Relevant WCAG criteria</li></ul>' },
                { id: 'help-scan-scope', cat: 'tool', title: 'Scan Scope',
                  keys: 'scan scope include selector limit area section pick element scope restrict',
                  body: '<p>By default, Pinpoint scans the entire page. Use <strong>Scan Scope</strong> in Settings to limit the scan to specific areas.</p><ul><li>Enter one or more CSS selectors (comma-separated), e.g. <code>#main, .content-area</code>.</li><li>Or click <strong>Pick element</strong> to visually click an element on the page — its selector is added automatically.</li></ul><p>This is useful when you only want to audit a particular component or section without noise from the rest of the page.</p>' },
                { id: 'help-exclude', cat: 'tool', title: 'Exclude Selectors',
                  keys: 'exclude selector ignore skip hide admin bar toolbar cms platform preset wordpress drupal',
                  body: '<p>Exclude Selectors let you skip parts of the page during scanning. This is especially useful for CMS admin bars and toolbars you don\'t control.</p><ul><li>Enter CSS selectors in the Exclude field, e.g. <code>#wpadminbar, .admin-toolbar</code>.</li><li>Use <strong>Pick element</strong> to visually select elements to exclude.</li><li>Use the <strong>Platform Preset</strong> dropdown above to apply common scope/exclude rules for WordPress, Drupal, Squarespace, Shopify, Wix, Joomla, Webflow, or LibGuides. Presets are remembered per&nbsp;hostname, so picking <em>LibGuides</em> on a guide site sets scan scope to the Springshare public containers (header, nav, main) only on that hostname; visiting a different site won\'t apply it.</li></ul><p>Pinpoint always excludes its own UI elements automatically.</p>' },
                { id: 'help-pick-element', cat: 'tool', title: 'Pick Element',
                  keys: 'pick element picker click visual select cursor crosshair',
                  body: '<p>The Pick Element feature lets you visually click elements on the page instead of writing CSS selectors by hand.</p><ul><li>Click <strong>Pick element</strong> next to either the Scan Scope or Exclude Selectors field.</li><li>The settings panel fades and your cursor becomes a crosshair.</li><li>Hover over elements to see them highlighted with a tooltip showing their tag and class.</li><li>Click an element to add its selector to the field.</li><li>Press <strong>Escape</strong> or click <strong>Done picking</strong> to exit picker mode.</li></ul>' },
                { id: 'help-wcag-settings', cat: 'tool', title: 'WCAG Version & Level',
                  keys: 'wcag version level conformance 2.0 2.1 2.2 A AA AAA settings standard',
                  body: '<p>In Settings under Accessibility, you can choose which WCAG version and conformance level to test against.</p><ul><li><strong>WCAG 2.0 / 2.1 / 2.2</strong> — newer versions add additional success criteria. 2.1 is the most widely adopted standard.</li><li><strong>Level A</strong> — minimum accessibility requirements.</li><li><strong>Level AA</strong> — the recommended target for most sites (and the legal standard in many jurisdictions).</li><li><strong>Level AAA</strong> — highest standard; enables enhanced contrast ratio rules (7:1 for normal text).</li></ul><p>Default is WCAG 2.1 AA.</p>' },
                { id: 'help-false-positives', cat: 'tool', title: 'Dismissing Issues',
                  keys: 'dismiss hide restore issue noise false positive ignore skip',
                  body: '<p>You can dismiss any reported issue to hide it from results — for example, a false positive, a known limitation you can\'t address, third-party markup you don\'t control, or just to focus on something else for now.</p><ul><li>Expand the issue and click the <strong>Dismiss</strong> button (it asks for a quick confirm to avoid accidents).</li><li>Dismissed issues are hidden from results and remembered across sessions for the current site.</li><li>To restore dismissed issues, go to <strong>Settings → Results → Restore all dismissed</strong>.</li></ul>' },
                { id: 'help-history', cat: 'tool', title: 'Score History',
                  keys: 'history score chart trend graph compare over time previous',
                  body: '<p>Pinpoint records each scan you run for the current URL so you can chart the accessibility trend over time. Open the <strong>History</strong> tab to see the line chart, a stacked bar of issue counts, the change since the previous scan, and lists of rules that were introduced or resolved.</p><ul><li>History is bucketed by URL <em>path</em> only — query strings and fragments are ignored, so different filtered views of the same page count as one site.</li><li>Stored locally in this browser, scoped to this origin. Different browsers, devices, or private windows have separate histories.</li><li>You can disable tracking, or clear history for this URL or for the entire site, in <strong>Settings → History</strong>.</li><li>Points on the chart that used a different WCAG level or a scoped scan are drawn with a hollow dot — they aren\'t directly comparable to the rest.</li></ul>' },
                { id: 'help-manual-verify', cat: 'tool', title: 'Manual Verification',
                  keys: 'manual verify check mark verified instance checkbox confirm',
                  body: '<p>Some issues need human judgment. Use the Prev/Next pager to step through each instance, then mark the one you\'re currently looking at as verified using the checkbox below the issue. A "X of N reviewed" indicator shows your progress. The Guided walkthrough and the Advanced view share the same per-instance state, so you can switch between them at any time without losing track. Once every instance of a rule is verified, the entire group is visually marked as complete.</p>' },
                { id: 'help-keyboard', cat: 'tool', title: 'Keyboard Shortcuts',
                  keys: 'keyboard shortcut hotkey key binding ctrl shift command',
                  body: '<p>Pinpoint supports keyboard shortcuts for efficient use:</p><ul><li><strong>Ctrl+Shift+A</strong> (or <strong>Cmd+Shift+A</strong> on Mac) — Launch or toggle Pinpoint.</li><li><strong>Escape</strong> — Close the panel or exit Pick Element mode.</li><li><strong>Tab / Shift+Tab</strong> — Navigate through results and controls.</li></ul>' },

                // ─── WCAG Reference ───
                { id: 'wcag-1.1.1', cat: 'wcag', title: '1.1.1 Non-text Content (A)',
                  keys: 'image alt text alternative non-text img decorative svg icon',
                  body: '<p>All non-text content (images, icons, charts) must have a text alternative that serves the same purpose.</p><ul><li>Add descriptive <code>alt</code> text to <code>&lt;img&gt;</code> elements.</li><li>Mark purely decorative images with <code>alt=""</code> or <code>role="presentation"</code>.</li><li>SVG icons should use <code>aria-label</code> or a visually hidden text label.</li><li>Complex images (charts, diagrams) need longer descriptions nearby.</li></ul>' },
                { id: 'wcag-1.2.1', cat: 'wcag', title: '1.2.1 Audio-only and Video-only Prerecorded (A)',
                  keys: 'audio video only prerecorded transcript alternative media podcast silent',
                  body: '<p>Provide an alternative for prerecorded audio-only and video-only content.</p><ul><li><strong>Audio-only</strong> (e.g. a podcast): provide a text transcript that includes all spoken words and important non-speech sounds.</li><li><strong>Video-only</strong> (e.g. a silent animation): provide either a text description or an audio track describing what is happening.</li></ul>' },
                { id: 'wcag-1.2.2', cat: 'wcag', title: '1.2.2 Captions Prerecorded (A)',
                  keys: 'captions subtitle prerecorded video media synchronized closed cc deaf',
                  body: '<p>Captions must be provided for all prerecorded audio in synchronized media (video with sound).</p><ul><li>Use real captions, not auto-generated transcripts that haven\'t been corrected.</li><li>Captions must include speaker identification and important non-speech sounds (laughter, music, applause).</li><li>Use <code>&lt;track kind="captions"&gt;</code> on <code>&lt;video&gt;</code> elements, or a player that supports caption files (WebVTT, SRT).</li></ul>' },
                { id: 'wcag-1.2.3', cat: 'wcag', title: '1.2.3 Audio Description or Media Alternative Prerecorded (A)',
                  keys: 'audio description media alternative transcript prerecorded video described',
                  body: '<p>For prerecorded video with sound, provide either an audio description of the visual content or a full text alternative (transcript) that describes both audio and video.</p><ul><li>An <strong>audio description</strong> is a separate narration track describing important visual information (actions, scene changes, on-screen text).</li><li>A <strong>media alternative</strong> is a text document containing all dialogue plus descriptions of visuals.</li></ul>' },
                { id: 'wcag-1.2.4', cat: 'wcag', title: '1.2.4 Captions Live (AA)',
                  keys: 'captions live synchronized media broadcast streaming realtime webinar',
                  body: '<p>Captions must be provided for all <strong>live</strong> audio content in synchronized media — webinars, livestreams, broadcasts, virtual events. Live captions can come from a stenographer/CART service or a high-quality speech-to-text engine, but accuracy matters.</p>' },
                { id: 'wcag-1.2.5', cat: 'wcag', title: '1.2.5 Audio Description Prerecorded (AA)',
                  keys: 'audio description prerecorded video described narration visual',
                  body: '<p>Audio description must be provided for all prerecorded video content. Unlike 1.2.3, the text-alternative option is not enough at AA — the video itself must include narrated descriptions of important visual information during pauses in dialogue.</p>' },
                { id: 'wcag-1.2.6', cat: 'wcag', title: '1.2.6 Sign Language Prerecorded (AAA)',
                  keys: 'sign language prerecorded video deaf interpreter ASL BSL',
                  body: '<p>Sign-language interpretation is provided for all prerecorded audio in synchronized media. This benefits users who are deaf and use sign language as their primary language, since written captions may not be as fluent for them.</p>' },
                { id: 'wcag-1.2.7', cat: 'wcag', title: '1.2.7 Extended Audio Description Prerecorded (AAA)',
                  keys: 'extended audio description prerecorded video pause narration',
                  body: '<p>When pauses in foreground audio are insufficient to allow audio descriptions to convey the sense of the video, provide an extended version where the video pauses to make room for additional description. Used when standard audio description (1.2.5) cannot fit all needed information.</p>' },
                { id: 'wcag-1.2.8', cat: 'wcag', title: '1.2.8 Media Alternative Prerecorded (AAA)',
                  keys: 'media alternative prerecorded transcript text full document',
                  body: '<p>An alternative for time-based media is provided for all prerecorded synchronized media and prerecorded video-only content. This is a full text document that captures all spoken dialogue plus descriptions of all important visual information — equivalent to a screenplay with stage directions.</p>' },
                { id: 'wcag-1.2.9', cat: 'wcag', title: '1.2.9 Audio-only Live (AAA)',
                  keys: 'audio only live transcript realtime broadcast radio podcast',
                  body: '<p>An alternative is provided for live audio-only content that presents equivalent information — typically a real-time text transcript via CART or live captioning service.</p>' },
                { id: 'wcag-1.3.1', cat: 'wcag', title: '1.3.1 Info and Relationships (A)',
                  keys: 'structure semantic heading list table form label relationship programmatic',
                  body: '<p>Information, structure, and relationships conveyed visually must also be available programmatically.</p><ul><li>Use proper heading hierarchy (<code>h1</code>–<code>h6</code>) — don\'t skip levels.</li><li>Use <code>&lt;ul&gt;</code>/<code>&lt;ol&gt;</code> for lists, <code>&lt;table&gt;</code> for tabular data.</li><li>Associate form inputs with <code>&lt;label&gt;</code> elements.</li><li>Use landmark elements (<code>&lt;nav&gt;</code>, <code>&lt;main&gt;</code>, <code>&lt;aside&gt;</code>) for page structure.</li></ul>' },
                { id: 'wcag-1.3.5', cat: 'wcag', title: '1.3.5 Identify Input Purpose (AA)',
                  keys: 'autocomplete input purpose identify name email phone address autofill',
                  body: '<p>Form inputs that collect personal information must identify their purpose using the <code>autocomplete</code> attribute so browsers and assistive technologies can auto-fill them.</p><ul><li>Use values like <code>autocomplete="name"</code>, <code>autocomplete="email"</code>, <code>autocomplete="tel"</code>.</li><li>This helps users with cognitive disabilities and motor impairments.</li></ul>' },
                { id: 'wcag-1.4.1', cat: 'wcag', title: '1.4.1 Use of Color (A)',
                  keys: 'color alone information meaning distinguish visual indicator',
                  body: '<p>Color must not be the only way to convey information. Always provide an additional visual cue.</p><ul><li>Error states: add an icon or text label, not just red color.</li><li>Required fields: use an asterisk or text, not just color.</li><li>Links within text: underline them or add another non-color indicator.</li><li>Charts/graphs: use patterns, labels, or textures in addition to color.</li></ul>' },
                { id: 'wcag-1.4.3', cat: 'wcag', title: '1.4.3 Contrast Minimum (AA)',
                  keys: 'contrast ratio color text background minimum 4.5 3 readability',
                  body: '<p>Text must have sufficient contrast against its background to be readable.</p><ul><li><strong>Normal text</strong> (under 18px or under 14px bold): minimum <strong>4.5:1</strong> ratio.</li><li><strong>Large text</strong> (18px+ or 14px+ bold): minimum <strong>3:1</strong> ratio.</li><li>Logos and purely decorative text are exempt.</li></ul><p>Use a contrast checker to test your color combinations. If you enable Level AAA, the thresholds become 7:1 and 4.5:1.</p>' },
                { id: 'wcag-1.4.4', cat: 'wcag', title: '1.4.4 Resize Text (AA)',
                  keys: 'resize text zoom 200% magnify font size scale reflow',
                  body: '<p>Text must be resizable up to 200% without loss of content or functionality. Avoid fixed pixel sizes for text — use relative units like <code>rem</code> or <code>em</code>. Ensure layouts don\'t break or hide content when the user zooms their browser to 200%.</p>' },
                { id: 'wcag-1.4.11', cat: 'wcag', title: '1.4.11 Non-text Contrast (AA)',
                  keys: 'non-text contrast UI component graphic boundary border icon focus indicator 3:1',
                  body: '<p>UI components (buttons, form fields, icons) and meaningful graphics must have at least a <strong>3:1</strong> contrast ratio against adjacent colors.</p><ul><li>Button borders or backgrounds must be distinguishable.</li><li>Form input outlines need sufficient contrast.</li><li>Custom focus indicators must meet the ratio.</li><li>Icons conveying meaning need adequate contrast.</li></ul>' },
                { id: 'wcag-2.1.1', cat: 'wcag', title: '2.1.1 Keyboard (A)',
                  keys: 'keyboard accessible tab focus navigate operable enter space click trap',
                  body: '<p>All functionality must be operable through a keyboard interface.</p><ul><li>Every interactive element must be reachable with <strong>Tab</strong>.</li><li>Buttons and links must activate with <strong>Enter</strong> (and <strong>Space</strong> for buttons).</li><li>Custom widgets need appropriate keyboard handlers.</li><li>Avoid keyboard traps — the user must always be able to Tab away from a component.</li></ul>' },
                { id: 'wcag-2.4.1', cat: 'wcag', title: '2.4.1 Bypass Blocks (A)',
                  keys: 'skip link bypass navigation block repeat header landmark main content',
                  body: '<p>Provide a way for keyboard users to skip repetitive navigation and go straight to main content.</p><ul><li>Add a <strong>Skip to main content</strong> link as the first focusable element.</li><li>Use landmark elements (<code>&lt;main&gt;</code>, <code>&lt;nav&gt;</code>) so screen reader users can jump between sections.</li><li>Use proper heading structure for easy navigation.</li></ul>' },
                { id: 'wcag-2.4.2', cat: 'wcag', title: '2.4.2 Page Titled (A)',
                  keys: 'page title head document title tag descriptive',
                  body: '<p>Every page must have a descriptive <code>&lt;title&gt;</code> that identifies its topic or purpose. For SPAs, update the title when the view changes. Titles should be unique across the site and describe the specific page, e.g. "Contact Us — Acme Corp" rather than just "Acme Corp".</p>' },
                { id: 'wcag-2.4.3', cat: 'wcag', title: '2.4.3 Focus Order (A)',
                  keys: 'focus order tab sequence logical navigation DOM order tabindex',
                  body: '<p>The focus order when tabbing through a page must be logical and meaningful. It should generally follow the visual reading order (left to right, top to bottom).</p><ul><li>Avoid positive <code>tabindex</code> values — they override natural order.</li><li>Make sure modals trap focus properly and return focus when closed.</li><li>Dynamically inserted content should receive focus or be announced.</li></ul>' },
                { id: 'wcag-2.4.4', cat: 'wcag', title: '2.4.4 Link Purpose (A)',
                  keys: 'link purpose text click here read more learn more anchor descriptive meaningful',
                  body: '<p>The purpose of each link should be clear from its text alone (or its surrounding context).</p><ul><li>Avoid generic text like "click here" or "read more".</li><li>If the link text is an image, the <code>alt</code> text serves as the link text.</li><li>Use <code>aria-label</code> or <code>aria-describedby</code> when visual context makes the link clear but the text alone doesn\'t.</li></ul>' },
                { id: 'wcag-2.4.6', cat: 'wcag', title: '2.4.6 Headings and Labels (AA)',
                  keys: 'heading label descriptive purpose form field h1 h2 h3 h4 h5 h6',
                  body: '<p>Headings and labels must describe the topic or purpose of the content they introduce.</p><ul><li>Headings should summarize the section they precede.</li><li>Form labels should clearly describe the expected input.</li><li>Don\'t use headings solely for visual styling — use CSS instead.</li></ul>' },
                { id: 'wcag-2.4.7', cat: 'wcag', title: '2.4.7 Focus Visible (AA)',
                  keys: 'focus visible indicator outline ring highlight keyboard tab style',
                  body: '<p>Keyboard users must be able to see which element is currently focused.</p><ul><li>Don\'t remove the browser\'s default focus outline with <code>outline: none</code> unless you replace it with an equally visible custom indicator.</li><li>Custom focus styles should have sufficient contrast (3:1 against adjacent colors per WCAG 2.4.11).</li><li>Test by tabbing through your page — if you lose track of where focus is, the indicator is insufficient.</li></ul>' },
                { id: 'wcag-2.5.3', cat: 'wcag', title: '2.5.3 Label in Name (A)',
                  keys: 'label name accessible visible speech voice control match',
                  body: '<p>When a component has a visible text label, its accessible name must contain that text. This ensures voice-control users can activate components by saying what they see.</p><ul><li>Don\'t use an <code>aria-label</code> that contradicts the visible text.</li><li>The accessible name should start with or match the visible label.</li></ul>' },
                { id: 'wcag-3.1.1', cat: 'wcag', title: '3.1.1 Language of Page (A)',
                  keys: 'language lang html attribute page document locale',
                  body: '<p>The default language of the page must be identified in the HTML. Add a <code>lang</code> attribute to the <code>&lt;html&gt;</code> element, e.g. <code>&lt;html lang="en"&gt;</code>. This enables screen readers to use the correct pronunciation rules. For multilingual content, use <code>lang</code> attributes on specific elements in other languages.</p>' },
                { id: 'wcag-3.3.1', cat: 'wcag', title: '3.3.1 Error Identification (A)',
                  keys: 'error identification form validation message input mistake describe',
                  body: '<p>When an input error is detected, the item in error must be identified and described in text.</p><ul><li>Show error messages near the field, not only at the top of the form.</li><li>Use <code>aria-describedby</code> to associate error text with the input.</li><li>Don\'t rely solely on color to indicate errors (see 1.4.1).</li><li>Mark invalid fields with <code>aria-invalid="true"</code>.</li></ul>' },
                { id: 'wcag-3.3.2', cat: 'wcag', title: '3.3.2 Labels or Instructions (A)',
                  keys: 'label instruction form input field hint placeholder guidance required',
                  body: '<p>Labels or instructions must be provided when content requires user input.</p><ul><li>Every form field needs a visible <code>&lt;label&gt;</code>.</li><li>Mark required fields clearly (not just with color).</li><li>Provide format hints for specific inputs (e.g. "MM/DD/YYYY").</li><li>Don\'t use <code>placeholder</code> as a substitute for labels — it disappears when the user starts typing.</li></ul>' },
                { id: 'wcag-4.1.1', cat: 'wcag', title: '4.1.1 Parsing (A)',
                  keys: 'parsing html valid duplicate id attribute markup nesting',
                  body: '<p>HTML must be well-formed so assistive technologies can parse it correctly.</p><ul><li>No duplicate <code>id</code> attributes on the same page.</li><li>Elements must be properly nested and closed.</li><li>Use a validator to check for markup errors.</li></ul><p><em>Note: WCAG 2.2 considers this criterion "always satisfied" for HTML, but valid markup is still best practice.</em></p>' },
                { id: 'wcag-4.1.2', cat: 'wcag', title: '4.1.2 Name, Role, Value (A)',
                  keys: 'name role value aria custom widget component accessible button link state',
                  body: '<p>All user-interface components must have an accessible name, an appropriate role, and expose their current state.</p><ul><li>Native HTML elements (<code>&lt;button&gt;</code>, <code>&lt;a&gt;</code>, <code>&lt;input&gt;</code>) get this automatically.</li><li>Custom components need ARIA: <code>role</code>, <code>aria-label</code>, <code>aria-expanded</code>, <code>aria-checked</code>, etc.</li><li>Test with a screen reader to verify custom widgets announce correctly.</li></ul>' },
                { id: 'wcag-4.1.3', cat: 'wcag', title: '4.1.3 Status Messages (AA)',
                  keys: 'status message live region aria-live polite assertive notification toast alert',
                  body: '<p>Status messages (success confirmations, error counts, loading states) must be programmatically communicated to assistive technologies without receiving focus.</p><ul><li>Use <code>role="status"</code> or <code>aria-live="polite"</code> for non-urgent messages.</li><li>Use <code>role="alert"</code> or <code>aria-live="assertive"</code> for urgent notifications.</li><li>Avoid moving focus just to announce a status change.</li></ul>' },

                // ─── AAA-level criteria ───
                { id: 'wcag-1.4.6', cat: 'wcag', title: '1.4.6 Contrast Enhanced (AAA)',
                  keys: 'contrast enhanced 7:1 4.5 ratio AAA color text background readability',
                  body: '<p>Stricter contrast requirements than 1.4.3. Aim for the highest readability for users with low vision.</p><ul><li><strong>Normal text</strong>: minimum <strong>7:1</strong> ratio.</li><li><strong>Large text</strong> (18px+ or 14px+ bold): minimum <strong>4.5:1</strong> ratio.</li><li>Logos and incidental text are exempt.</li></ul><p>This is one of the most commonly required AAA criteria — design systems targeting AAA should bake these ratios into color tokens.</p>' },
                { id: 'wcag-1.4.8', cat: 'wcag', title: '1.4.8 Visual Presentation (AAA)',
                  keys: 'visual presentation line spacing paragraph width column justify foreground background',
                  body: '<p>For blocks of text, users must be able to control visual presentation:</p><ul><li>Foreground and background colors can be selected by the user.</li><li>Text width is no more than <strong>80 characters</strong> (or 40 for CJK).</li><li>Text is not justified (no flush left and right).</li><li>Line spacing is at least <strong>1.5×</strong> within paragraphs.</li><li>Paragraph spacing is at least <strong>1.5×</strong> the line spacing.</li><li>Text can be resized to 200% without horizontal scrolling.</li></ul>' },
                { id: 'wcag-1.4.9', cat: 'wcag', title: '1.4.9 Images of Text No Exception (AAA)',
                  keys: 'image text no exception bitmap raster graphic essential decoration',
                  body: '<p>Images of text must not be used except when essential (like logos or when a particular presentation is required, e.g. a screenshot of code). Always use real text styled with CSS instead of rendering text into images.</p>' },
                { id: 'wcag-2.1.3', cat: 'wcag', title: '2.1.3 Keyboard No Exception (AAA)',
                  keys: 'keyboard no exception accessible interface drawing path stroke timing',
                  body: '<p>Stricter version of 2.1.1. <strong>All</strong> functionality must be operable via keyboard, with no exceptions for path-dependent input. Drawing apps, signature pads, and other free-form input components must provide keyboard alternatives.</p>' },
                { id: 'wcag-2.2.3', cat: 'wcag', title: '2.2.3 No Timing (AAA)',
                  keys: 'timing time limit deadline session expire essential',
                  body: '<p>Time limits are not an essential part of the activity. Avoid timed quizzes, session timeouts, or auto-advancing carousels unless the time limit is essential (e.g. an auction or live event). When time limits are required, allow users to extend or disable them.</p>' },
                { id: 'wcag-2.3.2', cat: 'wcag', title: '2.3.2 Three Flashes (AAA)',
                  keys: 'flash flashing seizure photosensitive epilepsy three blink animation',
                  body: '<p>Stricter than 2.3.1: web pages must not contain anything that flashes more than three times in any one-second period — full stop, regardless of the flash area. Avoid flashing animations, strobing video, and rapidly-changing visual effects entirely.</p>' },
                { id: 'wcag-2.4.8', cat: 'wcag', title: '2.4.8 Location (AAA)',
                  keys: 'location breadcrumb navigation orient site map current page sitemap',
                  body: '<p>Information about the user\'s location within a set of pages is available.</p><ul><li>Provide breadcrumbs showing the path through the site hierarchy.</li><li>Highlight the current page in the navigation.</li><li>Use a sitemap or page-locator widget for complex sites.</li></ul>' },
                { id: 'wcag-2.4.9', cat: 'wcag', title: '2.4.9 Link Purpose Link Only (AAA)',
                  keys: 'link purpose link only context isolation descriptive text alone',
                  body: '<p>Stricter than 2.4.4: each link\'s purpose must be identifiable from the <strong>link text alone</strong>, without relying on surrounding context. This means no "click here" or "more info" — every link must stand on its own (or use <code>aria-label</code> to provide standalone text).</p>' },
                { id: 'wcag-2.4.10', cat: 'wcag', title: '2.4.10 Section Headings (AAA)',
                  keys: 'section heading organize content structure outline navigate',
                  body: '<p>Use section headings to organize content. Long-form content (articles, documentation) should be broken up with descriptive headings so users — especially screen reader users — can scan and navigate by heading.</p>' },
                { id: 'wcag-3.1.5', cat: 'wcag', title: '3.1.5 Reading Level (AAA)',
                  keys: 'reading level plain language jargon literacy education complex simple',
                  body: '<p>When text requires reading ability beyond a lower secondary education level (about age 14), provide supplemental content or a simpler version. Use plain language tools and readability calculators (Flesch-Kincaid, etc.) to assess complexity. This benefits users with cognitive disabilities, non-native speakers, and everyone in a hurry.</p>' },
                { id: 'wcag-3.2.5', cat: 'wcag', title: '3.2.5 Change on Request (AAA)',
                  keys: 'change request context user initiate confirm submit form auto',
                  body: '<p>Changes of context (new windows, form submissions, navigation) happen only at the user\'s request — never automatically. Avoid auto-submitting forms when a value changes, auto-navigating after a delay, or popping new windows without user action.</p>' },
                { id: 'wcag-3.3.6', cat: 'wcag', title: '3.3.6 Error Prevention All (AAA)',
                  keys: 'error prevention all reverse review confirm submit form data',
                  body: '<p>Stricter than 3.3.4: for <strong>any</strong> form that requires user input, provide at least one of:</p><ul><li><strong>Reversible</strong> — submissions can be undone.</li><li><strong>Checked</strong> — input is validated and the user can correct errors.</li><li><strong>Confirmed</strong> — user can review, confirm, and correct before submitting.</li></ul>' },

                // ─── Remaining 1.3 / 1.4 criteria ───
                { id: 'wcag-1.3.2', cat: 'wcag', title: '1.3.2 Meaningful Sequence (A)',
                  keys: 'meaningful sequence reading order DOM source CSS visual logical',
                  body: '<p>When the sequence in which content is presented affects its meaning, the correct reading order must be programmatically determinable. The DOM order should match the visual reading order so screen readers and reflowed layouts present content correctly. Avoid using CSS positioning to reorder content in ways the underlying markup doesn\'t reflect.</p>' },
                { id: 'wcag-1.3.3', cat: 'wcag', title: '1.3.3 Sensory Characteristics (A)',
                  keys: 'sensory shape size location sound visual instruction reference',
                  body: '<p>Instructions must not rely solely on sensory characteristics like shape, color, size, visual location, orientation, or sound.</p><ul><li>Bad: "Click the round button on the right."</li><li>Good: "Click the round Submit button on the right."</li><li>Provide text labels alongside any shape/color/position-based references.</li></ul>' },
                { id: 'wcag-1.3.4', cat: 'wcag', title: '1.3.4 Orientation (AA)',
                  keys: 'orientation portrait landscape rotate device lock essential',
                  body: '<p>Content must not be locked to a single display orientation (portrait or landscape) unless a specific orientation is essential. Users mounting devices in fixed positions (wheelchairs, beds) need both orientations to work.</p>' },
                { id: 'wcag-1.3.6', cat: 'wcag', title: '1.3.6 Identify Purpose (AAA)',
                  keys: 'identify purpose icon symbol UI component metadata personalization',
                  body: '<p>The purpose of UI components, icons, and regions must be programmatically determinable. This supports personalization tools (e.g. symbol overlays for users with cognitive disabilities) that swap unfamiliar icons for known ones. Use ARIA landmarks, roles, and microdata so assistive tech can recognize purpose.</p>' },
                { id: 'wcag-1.4.2', cat: 'wcag', title: '1.4.2 Audio Control (A)',
                  keys: 'audio control autoplay pause stop mute volume background sound',
                  body: '<p>If audio plays automatically for more than 3 seconds, provide a mechanism to pause, stop, or independently control its volume. Auto-playing audio interferes with screen readers and is disruptive — the safest practice is to never autoplay audio at all.</p>' },
                { id: 'wcag-1.4.5', cat: 'wcag', title: '1.4.5 Images of Text (AA)',
                  keys: 'images of text bitmap graphic logo essential customizable real',
                  body: '<p>Use real text styled with CSS rather than images of text, except when a particular presentation is essential (logos, brand assets) or when the user can customize the image. Real text scales, reflows, can be translated, and respects user font settings.</p>' },
                { id: 'wcag-1.4.7', cat: 'wcag', title: '1.4.7 Low or No Background Audio (AAA)',
                  keys: 'background audio noise speech foreground 20 decibel quiet',
                  body: '<p>For prerecorded audio-only content with primarily speech, background sounds must be at least <strong>20 dB</strong> lower than the foreground speech (or absent). This helps users with hearing loss separate speech from ambient noise.</p>' },
                { id: 'wcag-1.4.10', cat: 'wcag', title: '1.4.10 Reflow (AA)',
                  keys: 'reflow responsive 320 viewport zoom mobile horizontal scroll one column',
                  body: '<p>Content must reflow into a single column at <strong>320 CSS pixels</strong> wide without requiring two-dimensional scrolling — except for content that genuinely needs 2D layout (maps, data tables, complex diagrams).</p><ul><li>Use responsive design with relative units and media queries.</li><li>Test by zooming to 400% in a 1280px viewport (which collapses content to ~320px wide).</li></ul>' },
                { id: 'wcag-1.4.12', cat: 'wcag', title: '1.4.12 Text Spacing (AA)',
                  keys: 'text spacing line height letter word paragraph override user style',
                  body: '<p>No loss of content or functionality when users override text spacing to:</p><ul><li>Line height at least <strong>1.5×</strong> font size</li><li>Paragraph spacing at least <strong>2×</strong> font size</li><li>Letter spacing at least <strong>0.12×</strong> font size</li><li>Word spacing at least <strong>0.16×</strong> font size</li></ul><p>Avoid fixed-height containers and <code>overflow: hidden</code> on text blocks.</p>' },
                { id: 'wcag-1.4.13', cat: 'wcag', title: '1.4.13 Content on Hover or Focus (AA)',
                  keys: 'hover focus tooltip popover dismissable hoverable persistent',
                  body: '<p>Content that appears on hover or focus (tooltips, popovers, custom menus) must be:</p><ul><li><strong>Dismissable</strong> — can be dismissed without moving pointer or focus (e.g. Escape key).</li><li><strong>Hoverable</strong> — the user can move the pointer onto the new content without it disappearing.</li><li><strong>Persistent</strong> — stays visible until dismissed, focus moves, or the trigger goes away.</li></ul>' },

                // ─── Remaining 2.1 criteria ───
                { id: 'wcag-2.1.2', cat: 'wcag', title: '2.1.2 No Keyboard Trap (A)',
                  keys: 'keyboard trap focus stuck escape exit navigate away modal',
                  body: '<p>If keyboard focus can be moved to a component, it must be possible to move focus away using only the keyboard. Common offenders are embedded plugins, custom widgets, and modals that don\'t handle Escape. The user should never get "stuck" inside a component.</p>' },
                { id: 'wcag-2.1.4', cat: 'wcag', title: '2.1.4 Character Key Shortcuts (A)',
                  keys: 'character key shortcut single letter remap disable hotkey speech',
                  body: '<p>If single-character keyboard shortcuts exist (e.g. press <kbd>j</kbd> to jump), users must be able to turn them off, remap them, or have them only fire when a specific element has focus. Single-key shortcuts can be triggered accidentally by speech-input users.</p>' },

                // ─── Remaining 2.2 criteria ───
                { id: 'wcag-2.2.1', cat: 'wcag', title: '2.2.1 Timing Adjustable (A)',
                  keys: 'time limit adjust extend disable session timeout countdown',
                  body: '<p>For each time limit set by the content, the user must be able to turn it off, adjust it, or extend it (at least 10× the default), unless the time limit is essential. Examples: session timeouts, timed quizzes, auto-rotating carousels.</p>' },
                { id: 'wcag-2.2.2', cat: 'wcag', title: '2.2.2 Pause, Stop, Hide (A)',
                  keys: 'pause stop hide moving blinking scrolling animation carousel auto',
                  body: '<p>For moving, blinking, scrolling, or auto-updating content that starts automatically, lasts more than 5 seconds, and is shown alongside other content, provide a way to pause, stop, or hide it.</p><ul><li>Carousels and auto-rotating banners need pause controls.</li><li>Animated GIFs and video previews need controls.</li><li>Live tickers and feeds need a pause option.</li></ul>' },
                { id: 'wcag-2.2.4', cat: 'wcag', title: '2.2.4 Interruptions (AAA)',
                  keys: 'interruptions postpone suppress notifications alerts emergency',
                  body: '<p>Interruptions (notifications, alerts, updates) can be postponed or suppressed by the user, except for emergencies. This helps users with cognitive disabilities or anyone trying to focus.</p>' },
                { id: 'wcag-2.2.5', cat: 'wcag', title: '2.2.5 Re-authenticating (AAA)',
                  keys: 're-authenticate session expire data preserve continue login',
                  body: '<p>When an authenticated session expires, the user can continue without losing data after re-authenticating. Save form data and restore it after login so users don\'t have to start over.</p>' },
                { id: 'wcag-2.2.6', cat: 'wcag', title: '2.2.6 Timeouts (AAA)',
                  keys: 'timeout warn inactivity data loss session preserve hours',
                  body: '<p>Warn users about the duration of any user inactivity that could cause data loss, unless the data is preserved for more than 20 hours when the user does not take any actions.</p>' },

                // ─── Remaining 2.3 criteria ───
                { id: 'wcag-2.3.1', cat: 'wcag', title: '2.3.1 Three Flashes or Below Threshold (A)',
                  keys: 'flash three flashing seizure threshold photosensitive epilepsy',
                  body: '<p>Web pages must not contain anything that flashes more than three times in any one-second period, or the flash must be below the general flash and red flash thresholds. Flashing content can trigger photosensitive seizures. The safest practice: avoid flashing entirely.</p>' },
                { id: 'wcag-2.3.3', cat: 'wcag', title: '2.3.3 Animation from Interactions (AAA)',
                  keys: 'animation interaction motion reduce vestibular parallax disable',
                  body: '<p>Motion animation triggered by interaction (parallax scrolling, transition effects, page slide-ins) can be disabled, unless the animation is essential. Honor the <code>prefers-reduced-motion</code> media query so users with vestibular disorders can opt out.</p><pre><code>@media (prefers-reduced-motion: reduce) { /* disable transforms */ }</code></pre>' },

                // ─── Remaining 2.4 criteria (incl. WCAG 2.2) ───
                { id: 'wcag-2.4.5', cat: 'wcag', title: '2.4.5 Multiple Ways (AA)',
                  keys: 'multiple ways navigate find page search sitemap menu links discovery',
                  body: '<p>More than one way must be available to locate a page within a set of pages, except when the page is the result of a process step. Provide at least two of: site navigation, site search, sitemap, table of contents, link list, or related-links.</p>' },
                { id: 'wcag-2.4.11', cat: 'wcag', title: '2.4.11 Focus Not Obscured Minimum (AA)',
                  keys: 'focus not obscured minimum sticky header cookie banner overlay hidden',
                  body: '<p>When a UI component receives keyboard focus, the focus indicator must not be <strong>entirely</strong> hidden by author-created content (sticky headers, cookie banners, floating action buttons). Test by tabbing through the page with sticky elements present. <em>(WCAG 2.2)</em></p>' },
                { id: 'wcag-2.4.12', cat: 'wcag', title: '2.4.12 Focus Not Obscured Enhanced (AAA)',
                  keys: 'focus not obscured enhanced fully visible sticky overlay hidden',
                  body: '<p>Stricter than 2.4.11: the focused component must not be obscured by author-created content at all — not even partially. <em>(WCAG 2.2)</em></p>' },
                { id: 'wcag-2.4.13', cat: 'wcag', title: '2.4.13 Focus Appearance (AAA)',
                  keys: 'focus appearance indicator size contrast outline ring perimeter',
                  body: '<p>Focus indicators must meet minimum size and contrast requirements:</p><ul><li>Area at least equal to a 2 CSS-pixel solid outline of the perimeter of the unfocused component.</li><li>Contrast ratio of at least <strong>3:1</strong> between focused and unfocused states.</li></ul><p><em>(WCAG 2.2)</em></p>' },

                // ─── Remaining 2.5 criteria (incl. WCAG 2.2) ───
                { id: 'wcag-2.5.1', cat: 'wcag', title: '2.5.1 Pointer Gestures (A)',
                  keys: 'pointer gestures multipoint path swipe pinch drag single tap alternative',
                  body: '<p>All functionality that uses multipoint or path-based gestures (pinch-to-zoom, swipe, drag) must also be operable with a single pointer without a path-based gesture, unless the gesture is essential.</p><ul><li>Provide buttons for zoom in/out alongside pinch gestures.</li><li>Provide arrow buttons alongside swipe carousels.</li></ul>' },
                { id: 'wcag-2.5.2', cat: 'wcag', title: '2.5.2 Pointer Cancellation (A)',
                  keys: 'pointer cancellation down up event abort undo click release',
                  body: '<p>For functionality operated by a single pointer, at least one of the following must be true:</p><ul><li>The down-event is not used to execute any part of the function.</li><li>Completion is on the up-event, and an abort/undo mechanism is available.</li><li>The up-event reverses the down-event.</li><li>Completing the function on the down-event is essential.</li></ul><p>This means: don\'t fire actions on <code>mousedown</code>/<code>pointerdown</code> — wait for <code>click</code>.</p>' },
                { id: 'wcag-2.5.4', cat: 'wcag', title: '2.5.4 Motion Actuation (A)',
                  keys: 'motion actuation shake tilt device sensor accelerometer alternative disable',
                  body: '<p>Functions triggered by device motion (shake to undo, tilt to scroll) must also be operable through standard UI controls, and the motion-triggered behavior must be disable-able to prevent accidental actuation. Users with tremors or fixed-mount devices need this.</p>' },
                { id: 'wcag-2.5.5', cat: 'wcag', title: '2.5.5 Target Size Enhanced (AAA)',
                  keys: 'target size enhanced 44 pixels touch tap area button click large',
                  body: '<p>The size of the target for pointer inputs must be at least <strong>44×44 CSS pixels</strong>, with limited exceptions (inline links in text, equivalent target available, user-agent default styling, essential).</p>' },
                { id: 'wcag-2.5.6', cat: 'wcag', title: '2.5.6 Concurrent Input Mechanisms (AAA)',
                  keys: 'concurrent input mechanism keyboard mouse touch switch restrict',
                  body: '<p>Don\'t restrict use of input modalities available on the platform. Users may switch between keyboard, mouse, touch, voice, and assistive devices freely, sometimes mid-task. Don\'t lock the page into a single input method.</p>' },
                { id: 'wcag-2.5.7', cat: 'wcag', title: '2.5.7 Dragging Movements (AA)',
                  keys: 'dragging movement single pointer alternative drag drop reorder slider',
                  body: '<p>All functionality that uses a dragging movement must be achievable with a single pointer without dragging, unless dragging is essential. For example, drag-and-drop reorder lists should also offer up/down arrow buttons, and sliders should be operable by clicking on the track. <em>(WCAG 2.2)</em></p>' },
                { id: 'wcag-2.5.8', cat: 'wcag', title: '2.5.8 Target Size Minimum (AA)',
                  keys: 'target size minimum 24 pixels touch tap button click spacing',
                  body: '<p>Pointer input targets must be at least <strong>24×24 CSS pixels</strong>, except when:</p><ul><li>Spacing — the target has at least a 24px-diameter circle of clearance to other targets.</li><li>The target is in a sentence or block of text.</li><li>An equivalent control of the right size exists.</li><li>The target is determined by the user agent.</li><li>The size is essential.</li></ul><p><em>(WCAG 2.2)</em></p>' },

                // ─── Remaining 3.1 criteria ───
                { id: 'wcag-3.1.2', cat: 'wcag', title: '3.1.2 Language of Parts (AA)',
                  keys: 'language parts lang attribute span foreign multilingual quotation',
                  body: '<p>The language of any passage or phrase that differs from the surrounding text must be programmatically identified. Use the <code>lang</code> attribute on elements containing foreign-language content, e.g. <code>&lt;span lang="fr"&gt;c\'est la vie&lt;/span&gt;</code>. Proper names, technical terms, and indeterminate words are exempt.</p>' },
                { id: 'wcag-3.1.3', cat: 'wcag', title: '3.1.3 Unusual Words (AAA)',
                  keys: 'unusual words jargon idiom definition glossary technical specialized',
                  body: '<p>Provide a mechanism for identifying specific definitions of words or phrases used in an unusual or restricted way, including idioms and jargon. Link unfamiliar terms to a glossary, use <code>&lt;dfn&gt;</code>, or provide inline definitions.</p>' },
                { id: 'wcag-3.1.4', cat: 'wcag', title: '3.1.4 Abbreviations (AAA)',
                  keys: 'abbreviation acronym expansion title abbr definition',
                  body: '<p>Provide a mechanism for identifying the expanded form or meaning of abbreviations. Use the <code>&lt;abbr title="..."&gt;</code> element, expand on first use ("World Health Organization (WHO)"), or link to a glossary.</p>' },
                { id: 'wcag-3.1.6', cat: 'wcag', title: '3.1.6 Pronunciation (AAA)',
                  keys: 'pronunciation phonetic ruby furigana ambiguous homograph',
                  body: '<p>A mechanism is available for identifying specific pronunciation of words where meaning is ambiguous without it. Particularly relevant for languages like Japanese (ruby/furigana) and for proper names with non-obvious pronunciation.</p>' },

                // ─── Remaining 3.2 criteria (incl. WCAG 2.2) ───
                { id: 'wcag-3.2.1', cat: 'wcag', title: '3.2.1 On Focus (A)',
                  keys: 'on focus context change automatic surprise unexpected',
                  body: '<p>Receiving focus must not trigger a change of context. Focus alone should never submit a form, navigate to a new page, open a new window, or significantly rearrange content. Wait for explicit user action like a click or Enter press.</p>' },
                { id: 'wcag-3.2.2', cat: 'wcag', title: '3.2.2 On Input (A)',
                  keys: 'on input change context select dropdown auto submit warn',
                  body: '<p>Changing the value of a form control must not automatically cause a change of context unless the user has been advised in advance. Common violation: a country dropdown that auto-submits the form when you change the selection. Provide a Submit button instead.</p>' },
                { id: 'wcag-3.2.3', cat: 'wcag', title: '3.2.3 Consistent Navigation (AA)',
                  keys: 'consistent navigation order menu repeat layout same pages',
                  body: '<p>Navigation mechanisms repeated across multiple pages must appear in the same relative order each time, unless the user changes them. Don\'t shuffle menu items or move the search box around.</p>' },
                { id: 'wcag-3.2.4', cat: 'wcag', title: '3.2.4 Consistent Identification (AA)',
                  keys: 'consistent identification label icon component same function',
                  body: '<p>Components with the same functionality must be identified consistently across pages. The "Search" button should always be labeled "Search", not "Find" on one page and "Go" on another. Same icons should mean the same thing site-wide.</p>' },
                { id: 'wcag-3.2.6', cat: 'wcag', title: '3.2.6 Consistent Help (A)',
                  keys: 'consistent help contact support chat phone same location order',
                  body: '<p>If a page contains help mechanisms (contact info, help links, chat, FAQ), they must appear in the same relative order across pages where they exist. Don\'t move the contact link from the footer to the header from one page to another. <em>(WCAG 2.2)</em></p>' },

                // ─── Remaining 3.3 criteria (incl. WCAG 2.2) ───
                { id: 'wcag-3.3.3', cat: 'wcag', title: '3.3.3 Error Suggestion (AA)',
                  keys: 'error suggestion correction fix recommend hint validation',
                  body: '<p>When an input error is detected and suggestions for correction are known, provide them to the user — unless doing so would jeopardize security or the purpose of the content. Examples: "Did you mean user@example.com?", "Password must contain at least one number".</p>' },
                { id: 'wcag-3.3.4', cat: 'wcag', title: '3.3.4 Error Prevention Legal Financial Data (AA)',
                  keys: 'error prevention legal financial data reversible checked confirmed',
                  body: '<p>For pages that cause legal commitments, financial transactions, modify or delete user data, or submit test responses, at least one of the following must be true:</p><ul><li><strong>Reversible</strong> — submissions can be undone.</li><li><strong>Checked</strong> — input is validated and the user can correct mistakes.</li><li><strong>Confirmed</strong> — user can review, confirm, and correct before submitting.</li></ul>' },
                { id: 'wcag-3.3.5', cat: 'wcag', title: '3.3.5 Help (AAA)',
                  keys: 'help context sensitive instruction documentation tooltip guidance',
                  body: '<p>Context-sensitive help is available for forms requiring user input. Provide tooltips, inline hints, examples, or links to relevant help content near the field where the user might need it.</p>' },
                { id: 'wcag-3.3.7', cat: 'wcag', title: '3.3.7 Redundant Entry (A)',
                  keys: 'redundant entry repeat information autofill remember session step',
                  body: '<p>Information previously entered by the user in the same process must be either auto-populated or available for the user to select, rather than requiring re-entry. Don\'t make users type their address twice in a checkout flow. Exceptions: re-entering for security (password confirmation), or when previously-entered information is no longer valid. <em>(WCAG 2.2)</em></p>' },
                { id: 'wcag-3.3.8', cat: 'wcag', title: '3.3.8 Accessible Authentication Minimum (AA)',
                  keys: 'accessible authentication minimum cognitive function test password recall puzzle',
                  body: '<p>Authentication processes must not rely on a cognitive function test (remembering a password, solving a puzzle, recognizing characters), unless an alternative is available or the test is for object recognition or non-text content the user provided.</p><ul><li>Allow paste into password fields.</li><li>Support password managers and WebAuthn/passkeys.</li><li>Don\'t require users to re-type confirmation codes manually — link/auto-fill them.</li></ul><p><em>(WCAG 2.2)</em></p>' },
                { id: 'wcag-3.3.9', cat: 'wcag', title: '3.3.9 Accessible Authentication Enhanced (AAA)',
                  keys: 'accessible authentication enhanced cognitive object recognition image puzzle',
                  body: '<p>Stricter than 3.3.8: even object-recognition and user-provided-content cognitive function tests are not allowed. The only acceptable authentication is one that does not rely on cognitive function tests at all (e.g. passkeys, biometrics, magic links). <em>(WCAG 2.2)</em></p>' },
            ];
        },

        renderHelp: function() {
            const wrap = this.shadowRoot.getElementById('uw-a11y-view-help');
            if (!wrap) return;
            const container = wrap.querySelector('.uw-a11y-help');
            if (!container) return;

            // Filter WCAG topics by the user's selected conformance level so the
            // reference matches what Pinpoint is actually testing against.
            const userLevel = String((this.loadSettings && this.loadSettings().wcagLevel) || 'AA').toUpperCase();
            const allowedLevels = userLevel === 'A'
                ? ['A']
                : (userLevel === 'AAA' ? ['A', 'AA', 'AAA'] : ['A', 'AA']);
            const topics = this.getHelpTopics().filter(t => {
                if (t.cat !== 'wcag') return true;
                const m = t.title.match(/\(([A]+)\)/);
                return m ? allowedLevels.indexOf(m[1]) !== -1 : true;
            });
            // Sort WCAG entries numerically by criterion (1.1.1, 1.3.1, …) so they
            // appear in spec order regardless of which level was added when.
            // Tool topics keep their authored order at the top.
            const wcagNumKey = (title) => {
                const m = title.match(/^(\d+)\.(\d+)\.(\d+)/);
                return m ? (parseInt(m[1],10)*10000 + parseInt(m[2],10)*100 + parseInt(m[3],10)) : 999999;
            };
            topics.sort((a, b) => {
                if (a.cat !== b.cat) return a.cat === 'tool' ? -1 : 1;
                if (a.cat === 'wcag') return wcagNumKey(a.title) - wcagNumKey(b.title);
                return 0;
            });

            container.innerHTML = `
                <h3>Help</h3>
                <div class="uw-a11y-help-search-wrap">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input id="uw-a11y-help-search" class="uw-a11y-help-search" type="search" placeholder="Search help topics and WCAG criteria..." aria-label="Search help">
                </div>
                <p class="uw-a11y-help-level-note">Showing WCAG criteria for your selected level: <strong>${userLevel}</strong>. Change this in Settings &rarr; Accessibility.</p>
                <div id="uw-a11y-help-results"></div>
            `;

            const searchInput = this.shadowRoot.getElementById('uw-a11y-help-search');
            const resultsDiv = this.shadowRoot.getElementById('uw-a11y-help-results');

            const escHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

            const highlightText = (html, terms) => {
                if (!terms.length) return html;
                // Only highlight inside text nodes, not inside tags
                const escRe = function(s) { return s.replace(/[-.*+?^$|(){}[\]\\]/g, '\\$&'); };
                const re = new RegExp('(' + terms.map(escRe).join('|') + ')', 'gi');
                return html.replace(/>([^<]+)</g, (full, text) => {
                    return '>' + text.replace(re, '<mark class="uw-a11y-help-hl">$1</mark>') + '<';
                });
            };

            const renderTopics = (query) => {
                const q = (query || '').trim().toLowerCase();
                const terms = q.split(/\s+/).filter(Boolean);

                let filtered = topics;
                if (terms.length > 0) {
                    filtered = topics.filter(t => {
                        const haystack = (t.title + ' ' + t.keys + ' ' + t.body.replace(/<[^>]+>/g, '')).toLowerCase();
                        return terms.every(term => haystack.includes(term));
                    });
                }

                const toolTopics = filtered.filter(t => t.cat === 'tool');
                const wcagTopics = filtered.filter(t => t.cat === 'wcag');

                if (filtered.length === 0) {
                    resultsDiv.innerHTML = '<div class="uw-a11y-help-empty">No topics match your search.</div>';
                    return;
                }

                let html = '';
                if (toolTopics.length > 0) {
                    html += '<p class="uw-a11y-help-category">Using Pinpoint</p>';
                    html += toolTopics.map(t => {
                        const body = terms.length > 0 ? highlightText(t.body, terms) : t.body;
                        const title = terms.length > 0 ? highlightText('>' + escHtml(t.title) + '<', terms).slice(1, -1) : escHtml(t.title);
                        return '<div class="uw-a11y-help-topic" data-id="' + t.id + '">' +
                            '<button class="uw-a11y-help-topic-head" aria-expanded="false">' + title + '</button>' +
                            '<div class="uw-a11y-help-topic-body" role="region">' + body + '</div></div>';
                    }).join('');
                }
                if (wcagTopics.length > 0) {
                    html += '<p class="uw-a11y-help-category">WCAG Reference</p>';
                    html += wcagTopics.map(t => {
                        const body = terms.length > 0 ? highlightText(t.body, terms) : t.body;
                        const title = terms.length > 0 ? highlightText('>' + escHtml(t.title) + '<', terms).slice(1, -1) : escHtml(t.title);
                        const level = t.title.match(/\(([A]+)\)/);
                        const tag = level ? '<span class="uw-a11y-help-tag">Level ' + escHtml(level[1]) + '</span>' : '';
                        return '<div class="uw-a11y-help-topic" data-id="' + t.id + '">' +
                            '<button class="uw-a11y-help-topic-head" aria-expanded="false">' + title + tag + '</button>' +
                            '<div class="uw-a11y-help-topic-body" role="region">' + body + '</div></div>';
                    }).join('');
                }

                resultsDiv.innerHTML = html;

                // If searching with results, auto-expand all matches
                if (terms.length > 0) {
                    resultsDiv.querySelectorAll('.uw-a11y-help-topic').forEach(el => {
                        el.classList.add('open');
                        el.querySelector('.uw-a11y-help-topic-head').setAttribute('aria-expanded', 'true');
                    });
                }
            };

            // Toggle expand/collapse
            resultsDiv.addEventListener('click', (e) => {
                const head = e.target.closest('.uw-a11y-help-topic-head');
                if (!head) return;
                const topic = head.closest('.uw-a11y-help-topic');
                const isOpen = topic.classList.toggle('open');
                head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            });

            let debounceTimer;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => renderTopics(searchInput.value), 120);
            });

            renderTopics('');
        },

        // ── Element Picker ─────────────────────────────────────────────────────

        startPickerMode: function(inputEl) {
            if (this.isPickerActive) return;
            this.isPickerActive = true;
            this.pickerTargetInput = inputEl;

            // Fade the panel so the user can see the page clearly
            const wrapper = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-wrapper');
            if (wrapper) {
                wrapper.dataset.pickerOrigOpacity = wrapper.style.opacity || '';
                wrapper.style.opacity = '0.15';
                wrapper.style.pointerEvents = 'none';
            }

            // Mark the relevant pick button as active (if still in DOM)
            const pickBtn = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-pick-element');
            const pickExcBtn = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-pick-exclude-element');
            if (pickBtn) pickBtn.classList.add('picker-active');
            if (pickExcBtn) pickExcBtn.classList.add('picker-active');

            this.injectPickerStyles();

            // Hover highlight box
            const highlight = document.createElement('div');
            highlight.id = 'uw-a11y-picker-highlight';
            highlight.setAttribute('aria-hidden', 'true');
            document.body.appendChild(highlight);
            this.pickerHighlightEl = highlight;

            // Tag/class badge tooltip
            const tooltip = document.createElement('div');
            tooltip.id = 'uw-a11y-picker-tooltip';
            tooltip.setAttribute('aria-hidden', 'true');
            document.body.appendChild(tooltip);
            this.pickerTooltipEl = tooltip;

            // "Done picking" button fixed at bottom-centre
            const doneBtn = document.createElement('button');
            doneBtn.id = 'uw-a11y-picker-done';
            doneBtn.textContent = 'Done picking';
            doneBtn.setAttribute('aria-label', 'Finish picking elements and return to settings');
            document.body.appendChild(doneBtn);
            this.pickerDoneBtn = doneBtn;
            doneBtn.addEventListener('click', () => this.stopPickerMode());

            document.body.style.cursor = 'crosshair';
            this.playSound('ui');

            this._pickerMoveHandler = (e) => this.onPickerMouseMove(e);
            this._pickerClickHandler = (e) => this.onPickerClick(e);
            this._pickerKeyHandler = (e) => { if (e.key === 'Escape') this.stopPickerMode(); };

            document.addEventListener('mousemove', this._pickerMoveHandler);
            document.addEventListener('click', this._pickerClickHandler, true);
            document.addEventListener('keydown', this._pickerKeyHandler, true);
        },

        stopPickerMode: function() {
            if (!this.isPickerActive) return;
            this.isPickerActive = false;

            // Restore panel
            const wrapper = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-wrapper');
            if (wrapper) {
                wrapper.style.opacity = wrapper.dataset.pickerOrigOpacity || '';
                wrapper.style.pointerEvents = '';
                delete wrapper.dataset.pickerOrigOpacity;
            }

            const pickBtn = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-pick-element');
            const pickExcBtn = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-pick-exclude-element');
            if (pickBtn) pickBtn.classList.remove('picker-active');
            if (pickExcBtn) pickExcBtn.classList.remove('picker-active');

            if (this.pickerHighlightEl) { this.pickerHighlightEl.remove(); this.pickerHighlightEl = null; }
            if (this.pickerTooltipEl) { this.pickerTooltipEl.remove(); this.pickerTooltipEl = null; }
            if (this.pickerDoneBtn) { this.pickerDoneBtn.remove(); this.pickerDoneBtn = null; }

            const st = document.getElementById('uw-a11y-picker-styles');
            if (st) st.remove();

            if (this._pickerMoveHandler) document.removeEventListener('mousemove', this._pickerMoveHandler);
            if (this._pickerClickHandler) document.removeEventListener('click', this._pickerClickHandler, true);
            if (this._pickerKeyHandler) document.removeEventListener('keydown', this._pickerKeyHandler, true);
            this._pickerMoveHandler = null;
            this._pickerClickHandler = null;
            this._pickerKeyHandler = null;

            document.body.style.cursor = '';
            this.playSound('ui');
            this.pickerTargetInput = null;
        },

        onPickerMouseMove: function(e) {
            const el = this.getPickerTargetAt(e.clientX, e.clientY);
            if (!el) {
                if (this.pickerHighlightEl) this.pickerHighlightEl.style.display = 'none';
                if (this.pickerTooltipEl) this.pickerTooltipEl.style.display = 'none';
                return;
            }
            const rect = el.getBoundingClientRect();
            const h = this.pickerHighlightEl;
            if (h) {
                h.style.display = 'block';
                h.style.left   = (rect.left + window.scrollX) + 'px';
                h.style.top    = (rect.top  + window.scrollY) + 'px';
                h.style.width  = rect.width  + 'px';
                h.style.height = rect.height + 'px';
            }
            const t = this.pickerTooltipEl;
            if (t) {
                t.style.display = 'block';
                t.textContent = this.getPickerBadgeText(el);
                const badgeTop = rect.top + window.scrollY - 28;
                t.style.left = (rect.left + window.scrollX) + 'px';
                t.style.top  = (badgeTop > 0 ? badgeTop : rect.bottom + window.scrollY + 4) + 'px';
            }
        },

        getPickerTargetAt: function(x, y) {
            const h = this.pickerHighlightEl;
            const t = this.pickerTooltipEl;
            const prevH = h ? h.style.display : null;
            const prevT = t ? t.style.display : null;
            if (h) h.style.display = 'none';
            if (t) t.style.display = 'none';

            let el = document.elementFromPoint(x, y);

            if (h && prevH !== null) h.style.display = prevH;
            if (t && prevT !== null) t.style.display = prevT;

            if (!el || el === document.documentElement || el === document.body) return null;

            // Skip the checker's own chrome
            const forbidden = new Set(['uw-a11y-picker-done', 'uw-a11y-picker-highlight', 'uw-a11y-picker-tooltip', 'uw-a11y-container']);
            if (el.id && forbidden.has(el.id)) return null;

            return el;
        },

        onPickerClick: function(e) {
            const el = this.getPickerTargetAt(e.clientX, e.clientY);
            if (!el) return;

            e.preventDefault();
            e.stopPropagation();

            // Stamp a unique attribute onto this exact element so the selector
            // can never accidentally match anything else on the page, regardless
            // of shared classes or tag names.
            this._pickerScopeSeq++;
            const scopeId = 'pp-' + this._pickerScopeSeq;
            el.setAttribute('data-pinpoint-scope', scopeId);
            const sel = `[data-pinpoint-scope="${scopeId}"]`;

            // Also remember a structural fallback selector so we can
            // re-stamp the data attribute when the user navigates to another
            // page on the same origin (the attribute itself doesn't survive
            // navigation; the selector lookup does).
            const fallback = this.generateSelectorForElement(el);
            if (fallback) {
                this.savePickerScopeFallback(scopeId, fallback);
            }

            const input = this.pickerTargetInput;
            if (input) {
                const existing = input.value.trim();
                input.value = existing ? existing + ', ' + sel : sel;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }

            this.playSound('verify');

            // Brief green flash, then exit picker mode
            if (this.pickerHighlightEl) {
                this.pickerHighlightEl.classList.add('uw-a11y-picker-selected');
            }
            setTimeout(() => this.stopPickerMode(), 350);
        },

        generateSelectorForElement: function(el) {
            if (!el || !el.tagName) return null;
            const tag = el.tagName.toLowerCase();

            // Helper: returns true if the selector uniquely matches exactly this element
            const isUnique = (sel) => {
                try {
                    const matches = document.querySelectorAll(sel);
                    return matches.length === 1 && matches[0] === el;
                } catch(_) { return false; }
            };

            // 1. Prefer ID (skip uw-a11y- internal IDs)
            if (el.id && !el.id.startsWith('uw-a11y-')) {
                return '#' + CSS.escape(el.id);
            }

            // 2. tag + significant classes — only if the combination is unique on the page
            const IGNORE = /^(active|hover|focus|selected|open|visible|hidden|show|fade|is-|has-|js-|uw-a11y-)/;
            const classes = Array.from(el.classList).filter(c => !IGNORE.test(c)).slice(0, 2);
            if (classes.length > 0) {
                const candidate = tag + '.' + classes.map(c => CSS.escape(c)).join('.');
                if (isUnique(candidate)) return candidate;
            }

            // 3. Landmark/semantic tags — only if unique
            if (['main', 'header', 'footer', 'nav', 'aside', 'article', 'form'].includes(tag)) {
                if (isUnique(tag)) return tag;
            }

            // 4. tag + aria-label
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) {
                const candidate = `${tag}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
                if (isUnique(candidate)) return candidate;
            }

            // 5. nth-of-type within parent (always unique for a specific position)
            const parent = el.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
                const idx = siblings.indexOf(el) + 1;
                const parentSel = parent.id
                    ? '#' + CSS.escape(parent.id)
                    : (parent.tagName.toLowerCase() === 'body' ? 'body' : parent.tagName.toLowerCase());
                return `${parentSel} > ${tag}:nth-of-type(${idx})`;
            }

            return tag;
        },

        getPickerBadgeText: function(el) {
            const tag = el.tagName.toLowerCase();
            const id = el.id ? '#' + el.id : '';
            const cls = el.classList.length > 0 ? '.' + Array.from(el.classList).slice(0, 2).join('.') : '';
            return tag + id + cls;
        },

        injectPickerStyles: function() {
            if (document.getElementById('uw-a11y-picker-styles')) return;
            const style = document.createElement('style');
            style.id = 'uw-a11y-picker-styles';
            style.textContent = `
                #uw-a11y-picker-highlight {
                    position: absolute;
                    pointer-events: none;
                    outline: 2px solid #0d6efd;
                    outline-offset: 1px;
                    background: rgba(13, 110, 253, 0.08);
                    z-index: 999998;
                    border-radius: 2px;
                    display: none;
                }
                #uw-a11y-picker-highlight.uw-a11y-picker-selected {
                    background: rgba(34, 160, 107, 0.2);
                    outline-color: #22a06b;
                }
                #uw-a11y-picker-tooltip {
                    position: absolute;
                    pointer-events: none;
                    background: #212529;
                    color: #fff;
                    font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                    padding: 3px 8px;
                    border-radius: 4px;
                    z-index: 999999;
                    white-space: nowrap;
                    display: none;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                }
                #uw-a11y-picker-done {
                    position: fixed;
                    bottom: 24px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 999999;
                    background: #0d6efd;
                    color: #fff;
                    border: none;
                    border-radius: 24px;
                    padding: 10px 24px;
                    font: 600 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                    cursor: pointer;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
                }
                #uw-a11y-picker-done:focus {
                    outline: 3px solid #fff;
                    outline-offset: 2px;
                }
                #uw-a11y-picker-done:hover {
                    background: #0b5ed7;
                }
            `;
            document.head.appendChild(style);
        },

        // ── End Element Picker ─────────────────────────────────────────────────

        // Escape for attribute values
        escapeHtmlAttr: function(str) {
            return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        },
        
        // Get axe-core version dynamically
        getAxeVersion: function() {
            if (window.axe && window.axe.version) {
                return window.axe.version;
            }
            return 'unknown';
        },

        // Load and save filter preferences (persisted in localStorage)
        loadFilters: function() {
            try {
                const stored = localStorage.getItem('uw-a11y-filters');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    this.filters = { errors: true, warnings: true, info: true, ...parsed };
                }
            } catch (e) { /* ignore */ }
        },
        saveFilters: function() {
            try {
                localStorage.setItem('uw-a11y-filters', JSON.stringify(this.filters));
            } catch (e) { /* ignore */ }
        },
        toggleFilter: function(kind) {
            if (!['errors','warnings','info'].includes(kind)) return;
            this.filters[kind] = !this.filters[kind];
            this.saveFilters();
            this.updateFilterUI();
            this.refreshIssueList();
            this.playSound('ui');
        },
        updateFilterUI: function() {
            const setState = (id, pressed) => {
                const btn = this.shadowRoot.getElementById(id);
                if (btn) btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
                const row = btn?.closest('.violationtype');
                if (row) row.style.color = pressed ? '#000' : '#ccc';
            };
            setState('toggle-errors', this.filters.errors);
            setState('toggle-warnings', this.filters.warnings);
            setState('toggle-info', this.filters.info);
        },
        getIssuesForFilters: function() {
            return this.issues.filter(i =>
                (i.type === 'error' && this.filters.errors) ||
                (i.type === 'warning' && this.filters.warnings) ||
                (i.type === 'info' && this.filters.info)
            );
        },
        refreshIssueList: function() {
            const results = this.shadowRoot.getElementById('uw-a11y-results');
            if (!results) return;
            const issuesToShow = this.getIssuesForFilters();
            const dismissed = this.getDismissedIssues();
            const groupedIssues = this.groupIssuesByRule(issuesToShow);
            // Filter out dismissed rule groups
            // Order rule groups by type (violations → manual review → best practice),
            // then by axe impact (critical → serious → moderate → minor → unknown),
            // then by node count desc so broader symptoms surface first.
            const typeRank = { error: 0, warning: 1, info: 2 };
            const impactRank = { critical: 0, serious: 1, moderate: 2, minor: 3 };
            const visibleRuleIds = Object.keys(groupedIssues)
                .filter(id => !dismissed.has(id))
                .sort((a, b) => {
                    const ga = groupedIssues[a][0];
                    const gb = groupedIssues[b][0];
                    const ta = typeRank[ga.type] == null ? 3 : typeRank[ga.type];
                    const tb = typeRank[gb.type] == null ? 3 : typeRank[gb.type];
                    if (ta !== tb) return ta - tb;
                    const ia = impactRank[(ga.impact || '').toLowerCase()];
                    const ib = impactRank[(gb.impact || '').toLowerCase()];
                    const iaR = ia == null ? 4 : ia;
                    const ibR = ib == null ? 4 : ib;
                    if (iaR !== ibR) return iaR - ibR;
                    return groupedIssues[b].length - groupedIssues[a].length;
                });
            if (visibleRuleIds.length === 0) {
                const dismissedCount = dismissed.size;
                results.innerHTML = `
                    <div class="uw-a11y-issue info">
                        <h4>No issues to display</h4>
                        <p>Adjust the filters above to show hidden groups${dismissedCount > 0 ? `, or <button class="uw-a11y-link-btn" data-uw-action="clearDismissedIssues">restore ${dismissedCount} dismissed issue${dismissedCount !== 1 ? 's' : ''}</button>` : ''}.</p>
                    </div>
                `;
                return;
            }
            const dismissedBanner = dismissed.size > 0 ? `
                <div class="uw-a11y-dismissed-banner">
                    ${dismissed.size} issue${dismissed.size !== 1 ? 's' : ''} dismissed &mdash;
                    <button class="uw-a11y-link-btn" data-uw-action="clearDismissedIssues">Restore all</button>
                </div>
            ` : '';
            const generatedHtml = dismissedBanner + visibleRuleIds.map((ruleId) => {
                const issueGroup = groupedIssues[ruleId];
                const firstIssue = issueGroup[0];
                const isManualReview = firstIssue.type === 'warning' && firstIssue.uniqueId;
                const instanceNavigation = issueGroup.length > 1 ? `
                        <div class=\"uw-a11y-instance-nav\">
                            <span class=\"uw-a11y-instance-count\">Instance <span id=\"current-${this.sanitizeHtmlId(ruleId)}\">1</span> of ${issueGroup.length}</span>
                            <div class=\"uw-a11y-nav-buttons\">
                                <button data-uw-action=\"navigateInstance\" data-uw-rule=\"${this.escapeHtmlAttribute(ruleId)}\" data-uw-dir=\"-1\"
                                        id=\"prev-${this.sanitizeHtmlId(ruleId)}\" disabled>‹ Prev</button>
                                <button data-uw-action=\"navigateInstance\" data-uw-rule=\"${this.escapeHtmlAttribute(ruleId)}\" data-uw-dir=\"1\"
                                        id=\"next-${this.sanitizeHtmlId(ruleId)}\">Next ›</button>
                            </div>
                        </div>
                    ` : '';
                const iconSvg = this.getIssueTypeIcon(firstIssue.type, 'issue');
                return `
                    <div class=\"uw-a11y-issue ${firstIssue.type} ${isManualReview && this.isRuleVerified(ruleId) ? 'checked' : ''}\"
                         data-uw-action=\"highlightCurrentInstance\" data-uw-rule=\"${this.escapeHtmlAttribute(ruleId)}\"
                         tabindex=\"0\"
                         role=\"button\"
                         aria-label=\"Click to highlight ${this.escapeHtmlAttribute(firstIssue.title)} on the page${issueGroup.length > 1 ? ` (${issueGroup.length} instances)` : ''}\"
                         id=\"issue-${this.sanitizeHtmlId(ruleId)}\">
                         ${instanceNavigation}
                        <h4>
                            <span class=\"uw-a11y-issue-header\">${iconSvg}<span class=\"uw-a11y-issue-title\">${this.escapeHtmlContent(firstIssue.title)} ${issueGroup.length > 1 ? `(${issueGroup.length} instances)` : ''}</span><span class=\"uw-a11y-issue-badge type-${firstIssue.type}\">${this.getIssueTypeLabel(firstIssue.type, isManualReview && this.isRuleVerified(ruleId))}</span></span>
                        </h4>
                        <div class=\"how-to-fix\"><div class=\"how-to-fix-icon\"><svg viewBox=\"0 0 512 512\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M331.8 224.1c28.29 0 54.88 10.99 74.86 30.97l19.59 19.59c40.01-17.74 71.25-53.3 81.62-96.65c5.725-23.92 5.34-47.08 .2148-68.4c-2.613-10.88-16.43-14.51-24.34-6.604l-68.9 68.9h-75.6V97.2l68.9-68.9c7.912-7.912 4.275-21.73-6.604-24.34c-21.32-5.125-44.48-5.51-68.4 .2148c-55.3 13.23-98.39 60.22-107.2 116.4C224.5 128.9 224.2 137 224.3 145l82.78 82.86C315.2 225.1 323.5 224.1 331.8 224.1zM384 278.6c-23.16-23.16-57.57-27.57-85.39-13.9L191.1 158L191.1 95.99l-127.1-95.99L0 63.1l96 127.1l62.04 .0077l106.7 106.6c-13.67 27.82-9.251 62.23 13.91 85.39l117 117.1c14.62 14.5 38.21 14.5 52.71-.0016l52.75-52.75c14.5-14.5 14.5-38.08-.0016-52.71L384 278.6zM227.9 307L168.7 247.9l-148.9 148.9c-26.37 26.37-26.37 69.08 0 95.45C32.96 505.4 50.21 512 67.5 512s34.54-6.592 47.72-19.78l119.1-119.1C225.5 352.3 222.6 329.4 227.9 307zM64 472c-13.25 0-24-10.75-24-24c0-13.26 10.75-24 24-24S88 434.7 88 448C88 461.3 77.25 472 64 472z\"/></svg></div><div><strong>How to fix:</strong> <span id=\"recommendation-${this.sanitizeHtmlId(ruleId)}\"></span></div></div>
                        ${isManualReview ? `
                        <div class=\"uw-a11y-manual-check\">
                          <label class=\"uw-a11y-checkbox\">
                            <input type=\"checkbox\" id=\"check-${this.sanitizeHtmlId(ruleId)}\" ${this.isInstanceVerifiedAt(issueGroup, 0) ? 'checked' : ''}
                                   data-uw-action=\"toggleInstanceVerification\" data-uw-rule=\"${this.escapeHtmlAttribute(ruleId)}\">
                            <span class=\"uw-a11y-checkmark\"></span>
                            <span class=\"uw-a11y-check-label\" id=\"check-label-${this.sanitizeHtmlId(ruleId)}\">${this.getInstanceCheckLabel(issueGroup, 0)}</span>
                          </label>
                          ${issueGroup.length > 1 ? `<span class=\"uw-a11y-instance-progress\" id=\"progress-${this.sanitizeHtmlId(ruleId)}\">${this.countVerifiedInGroup(issueGroup)} of ${issueGroup.length} reviewed</span>` : ''}
                        </div>` : ''}
                        ${firstIssue.detailedInfo && firstIssue.detailedInfo.length > 0 ? `
                            <button class=\"uw-a11y-details-toggle\" data-uw-action=\"toggleDetails\" data-uw-rule=\"${this.escapeHtmlAttribute(ruleId)}\">Show technical details</button>
                            <div class=\"uw-a11y-details\" id=\"details-${this.sanitizeHtmlId(ruleId)}\"><div id=\"detailed-content-${this.sanitizeHtmlId(ruleId)}\">${this.renderDetailedInfo(firstIssue.detailedInfo)}</div></div>
                        ` : ''}
                        <div class=\"issue-meta\"><div><strong>Impact:</strong> ${this.escapeHtmlContent(firstIssue.impact || 'unknown')}
                        ${firstIssue.helpUrl ? `<br><a href=\"${this.escapeUrl(firstIssue.helpUrl)}\" target=\"_blank\" class=\"learn-more\">Learn more about this rule</a>` : ''}
                        </div>
                        <button class=\"uw-a11y-dismiss-btn\" title=\"Hide this issue from results\" data-uw-action=\"dismissIssue\" data-uw-rule=\"${this.escapeHtmlAttribute(ruleId)}\">Dismiss</button>
                        </div>
                    </div>`;
            }).join('');
            results.innerHTML = generatedHtml;
            // initialize rec content
            Object.keys(groupedIssues).forEach(ruleId => {
                const issueGroup = groupedIssues[ruleId];
                const firstIssue = issueGroup[0];
                const recElement = this.shadowRoot.getElementById(`recommendation-${ruleId}`);
                if (recElement) recElement.innerHTML = this.decorateRecommendation(firstIssue.recommendation, firstIssue.ruleId);
            });
        },
        
        // ── Dismissed (false positive) issue management ──────────────────────
        getDismissedIssues: function() {
            try {
                const stored = localStorage.getItem('uw-a11y-dismissed');
                return stored ? new Set(JSON.parse(stored)) : new Set();
            } catch (_) { return new Set(); }
        },

        saveDismissedIssues: function(dismissed) {
            try {
                localStorage.setItem('uw-a11y-dismissed', JSON.stringify([...dismissed]));
            } catch (_) {}
        },

        dismissIssue: function(ruleId, btn) {
            // Two-step confirmation: first click warns, second click within 4s confirms.
            if (btn && !btn.dataset.confirming) {
                btn.dataset.confirming = '1';
                btn.textContent = 'Confirm dismiss';
                btn.title = 'Click again to confirm dismissing this issue.';
                btn.classList.add('uw-a11y-dismiss-btn--confirming');

                const t = setTimeout(() => {
                    if (btn.isConnected) {
                        delete btn.dataset.confirming;
                        btn.textContent = 'Dismiss';
                        btn.title = 'Hide this issue from results';
                        btn.classList.remove('uw-a11y-dismiss-btn--confirming');
                    }
                }, 4000);
                btn.dataset.confirmTimeout = String(t);
                return;
            }

            // Second click (or direct call without btn): actually dismiss
            if (btn && btn.dataset.confirmTimeout) {
                clearTimeout(parseInt(btn.dataset.confirmTimeout, 10));
            }

            const dismissed = this.getDismissedIssues();
            dismissed.add(ruleId);
            this.saveDismissedIssues(dismissed);
            this.refreshIssueList();
            this.updateScore();
            this.updateDismissedCount();
        },

        clearDismissedIssues: function() {
            localStorage.removeItem('uw-a11y-dismissed');
            this.refreshIssueList();
            this.updateScore();
            this.updateDismissedCount();
        },

        // Update the dismissed count badge in Settings (if the panel is open)
        updateDismissedCount: function() {
            const el = this.shadowRoot.getElementById('uw-a11y-dismissed-count');
            if (!el) return;
            const count = this.getDismissedIssues().size;
            el.textContent = count > 0 ? `${count} dismissed` : 'None';
            const clearBtn = this.shadowRoot.getElementById('uw-a11y-clear-dismissed');
            if (clearBtn) clearBtn.hidden = count === 0;
        },

        addIssue: function(type, title, description, element, recommendation, helpUrl, impact, tags, detailedInfo, ruleId) {
            const issueId = this.issues.length; // Use array index as unique ID
            // Attempt to compute a selector for resilience if the DOM re-renders
            let selector = '';
            if (element && element instanceof Element) {
                selector = this.computeElementSelector(element);
            } else if (Array.isArray(detailedInfo)) {
                const selEntry = detailedInfo.find(d => d && d.type === 'selector' && typeof d.value === 'string');
                if (selEntry) selector = selEntry.value;
            }
            this.issues.push({
                id: issueId,
                type: type,
                title: title,
                description: description,
                element: element,
                selector: selector || '',
                recommendation: recommendation,
                helpUrl: helpUrl,
                impact: impact,
                tags: tags || [],
                detailedInfo: detailedInfo || [],
                ruleId: ruleId || title.toLowerCase().replace(/[^a-z0-9]/g, '-')
            });
        },
        
        // Announce results to screen readers via ARIA live region
        announceResults: function(scoreData, counts) {
            const announcements = this.shadowRoot.getElementById('uw-a11y-announcements');
            if (!announcements) return;
            
            let message = '';
            
            if (scoreData) {
                const score = scoreData.score;
                const ratingText = score >= 97 ? 'Excellent' : 
                                  score >= 90 ? 'Very Good' : 
                                  score >= 70 ? 'Good' : 
                                  score >= 50 ? 'Fair' : 
                                  'Needs immediate attention';
                
                message += `Accessibility test complete. Score: ${score} out of 100, rated as ${ratingText}. `;
            }
            
            const totalIssues = counts.error + counts.warning;
            if (totalIssues === 0) {
                message += 'No accessibility violations found. Excellent work!';
            } else {
                message += `Found ${totalIssues} total issues: `;
                if (counts.error > 0) {
                    message += `${counts.error} violation${counts.error === 1 ? '' : 's'} requiring immediate attention`;
                }
                if (counts.warning > 0) {
                    if (counts.error > 0) message += ' and ';
                    message += `${counts.warning} item${counts.warning === 1 ? '' : 's'} requiring manual review`;
                }
                if (counts.warningChecked > 0) {
                    message += `. ${counts.warningChecked} item${counts.warningChecked === 1 ? '' : 's'} already verified`;
                }
                message += '. Navigate through the list below to review each issue.';
            }
            
            // Use setTimeout to ensure the live region is ready
            setTimeout(() => {
                announcements.textContent = message;
            }, 500);
        },
        
        // Set focus to the accessibility checker panel for keyboard navigation
        setFocusToPanel: function() {
            // Use a small delay to ensure DOM is fully rendered
            setTimeout(() => {
                const panel = this.shadowRoot.getElementById('uw-a11y-panel');
                if (panel) {
                    panel.focus();
                    // Scroll into view if needed
                    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 100);
        },
        
        // Update visibility of elements with if-issues class
        updateIfIssuesVisibility: function() {
            const hasIssues = this.issues.length > 0;
            const ifIssuesElements = this.shadowRoot.querySelectorAll('.if-issues');
            
            ifIssuesElements.forEach(element => {
                if (hasIssues) {
                    element.style.display = '';
                } else {
                    element.style.display = 'none';
                }
            });
        },
        
        // ── Guided view ────────────────────────────────────────────────────
        // Friendly, plain-English headlines for the most common axe rule IDs.
        // Anything not in this map falls back to the rule's own title/description,
        // so adding entries is purely additive — broken rules just look like the
        // existing detailed view.
        getFriendlyRuleHeadline: function(ruleId, fallback, issueType) {
            // Headlines for confirmed violations — the checker has measured these
            // and knows they fail, so the wording is definitive.
            const violationMap = {
                'color-contrast': 'Text is hard to read in places',
                'color-contrast-enhanced': 'Text contrast is below the AAA threshold',
                'image-alt': 'Some images are missing alt text',
                'input-image-alt': 'An image button needs alt text',
                'area-alt': 'An image-map area is missing alt text',
                'svg-img-alt': 'An SVG used as an image is missing a label',
                'role-img-alt': 'An element with role="img" needs a label',
                'label': 'A form input has no label',
                'form-field-multiple-labels': 'A form field has conflicting labels',
                'select-name': 'A select dropdown has no accessible name',
                'button-name': 'A button has no accessible name',
                'link-name': 'A link has no readable text',
                'link-in-text-block': 'A link blends in with surrounding text',
                'empty-heading': 'A heading is empty',
                'heading-order': 'Headings skip levels in the page outline',
                'page-has-heading-one': 'The page is missing an <h1>',
                'document-title': 'The page is missing a <title>',
                'html-has-lang': 'The page is missing a language attribute',
                'html-lang-valid': 'The page’s language code looks invalid',
                'valid-lang': 'A language code on an element looks invalid',
                'aria-allowed-attr': 'Some ARIA attributes look wrong',
                'aria-allowed-role': 'A role is being used on the wrong kind of element',
                'aria-required-attr': 'An ARIA widget is missing required attributes',
                'aria-required-children': 'An ARIA container is missing expected children',
                'aria-required-parent': 'An ARIA element needs a specific parent',
                'aria-roles': 'An ARIA role looks invalid',
                'aria-valid-attr': 'An ARIA attribute name looks invalid',
                'aria-valid-attr-value': 'An ARIA attribute has an unexpected value',
                'aria-hidden-body': 'The whole page is hidden from screen readers',
                'aria-hidden-focus': 'Something focusable is hidden from screen readers',
                'aria-input-field-name': 'An ARIA input has no accessible name',
                'aria-toggle-field-name': 'An ARIA toggle has no accessible name',
                'aria-command-name': 'An ARIA command has no accessible name',
                'aria-progressbar-name': 'A progress bar has no accessible name',
                'aria-meter-name': 'A meter has no accessible name',
                'aria-tooltip-name': 'A tooltip has no accessible name',
                'aria-treeitem-name': 'A tree item has no accessible name',
                'list': 'A list contains the wrong kind of children',
                'listitem': 'A list item is outside of a list',
                'definition-list': 'A definition list is structured incorrectly',
                'dlitem': 'A definition list item is outside of a <dl>',
                'duplicate-id': 'Two elements share the same ID',
                'duplicate-id-active': 'Two interactive elements share the same ID',
                'duplicate-id-aria': 'Two ARIA-referenced elements share the same ID',
                'frame-title': 'An iframe has no title',
                'frame-title-unique': 'Two iframes share the same title',
                'object-alt': 'An <object> element has no text alternative',
                'video-caption': 'A video is missing captions',
                'audio-caption': 'Audio is missing a caption track',
                'meta-viewport': 'The viewport disables zoom',
                'meta-refresh': 'The page auto-refreshes, which is disorienting',
                'tabindex': 'A positive tabindex disrupts the tab order',
                'bypass': 'There’s no skip-to-content shortcut',
                'region': 'Some content sits outside any landmark region',
                'landmark-one-main': 'The page has no <main> landmark',
                'landmark-no-duplicate-banner': 'The page has more than one banner',
                'landmark-no-duplicate-contentinfo': 'The page has more than one contentinfo',
                'landmark-no-duplicate-main': 'The page has more than one <main>',
                'scope-attr-valid': 'A table’s scope attribute is invalid',
                'scrollable-region-focusable': 'A scrollable region isn’t keyboard reachable',
                'autocomplete-valid': 'A form field’s autocomplete value is invalid',
                'avoid-inline-spacing': 'Inline styles override accessibility spacing',
                'nested-interactive': 'An interactive element is nested inside another',
                'no-autoplay-audio': 'Audio plays automatically and can’t be paused',
                'blink': 'A <blink> element will distract some users',
                'marquee': 'A <marquee> element will distract some users'
            };

            // Headlines for manual-review (axe `incomplete`) items — the checker
            // couldn't determine whether the rule passes, so the wording is
            // suggestive ("may", "might") rather than definitive.
            const manualReviewMap = {
                'color-contrast': 'Text may be hard to read in places',
                'color-contrast-enhanced': 'Text contrast may be below the AAA threshold',
                'image-alt': 'Some images may be missing meaningful alt text',
                'input-image-alt': 'An image button may need alt text',
                'area-alt': 'An image-map area may be missing alt text',
                'svg-img-alt': 'An SVG used as an image may be missing a label',
                'role-img-alt': 'An element with role="img" may need a label',
                'label': 'A form input may not have a label',
                'select-name': 'A select dropdown may not have an accessible name',
                'button-name': 'A button may not have an accessible name',
                'link-name': 'A link may not have readable text',
                'link-in-text-block': 'A link may blend in with surrounding text',
                'empty-heading': 'A heading may be empty',
                'heading-order': 'Headings may skip levels in the page outline',
                'aria-allowed-attr': 'Some ARIA attributes may be misused',
                'aria-required-attr': 'An ARIA widget may be missing required attributes',
                'aria-required-children': 'An ARIA container may be missing expected children',
                'aria-required-parent': 'An ARIA element may need a specific parent',
                'aria-valid-attr-value': 'An ARIA attribute may have an unexpected value',
                'aria-hidden-focus': 'Something focusable may be hidden from screen readers',
                'aria-input-field-name': 'An ARIA input may not have an accessible name',
                'aria-toggle-field-name': 'An ARIA toggle may not have an accessible name',
                'aria-command-name': 'An ARIA command may not have an accessible name',
                'aria-progressbar-name': 'A progress bar may not have an accessible name',
                'aria-meter-name': 'A meter may not have an accessible name',
                'aria-tooltip-name': 'A tooltip may not have an accessible name',
                'aria-treeitem-name': 'A tree item may not have an accessible name',
                'frame-title': 'An iframe may not have a meaningful title',
                'frame-title-unique': 'Two iframes may share the same title',
                'object-alt': 'An <object> element may not have a text alternative',
                'video-caption': 'A video may be missing captions',
                'audio-caption': 'Audio may be missing a caption track',
                'region': 'Some content may sit outside any landmark region',
                'scrollable-region-focusable': 'A scrollable region may not be keyboard reachable',
                'autocomplete-valid': 'A form field’s autocomplete value may be invalid',
                'nested-interactive': 'An interactive element may be nested inside another'
            };

            if (issueType === 'warning' && manualReviewMap[ruleId]) {
                return manualReviewMap[ruleId];
            }
            return violationMap[ruleId] || fallback;
        },

        // Allowlist of axe rule IDs whose problems and fixes are understandable
        // to non-developers (content authors, designers, marketers). Anything
        // that requires reading/writing ARIA, understanding landmark roles, or
        // editing markup structure is intentionally excluded — those land in
        // Advanced view, where the tone matches the audience. Every entry here
        // should also have a friendly headline in `getFriendlyRuleHeadline`.
        getApproachableRules: function() {
            return new Set([
                'color-contrast',
                'color-contrast-enhanced',
                'image-alt',
                'input-image-alt',
                'area-alt',
                'svg-img-alt',
                'role-img-alt',
                'object-alt',
                'label',
                'form-field-multiple-labels',
                'select-name',
                'button-name',
                'link-name',
                'link-in-text-block',
                'empty-heading',
                'heading-order',
                'page-has-heading-one',
                'document-title',
                'html-has-lang',
                'html-lang-valid',
                'valid-lang',
                'frame-title',
                'frame-title-unique',
                'video-caption',
                'audio-caption',
                'meta-viewport',
                'meta-refresh',
                'no-autoplay-audio',
                'duplicate-id',
                'blink',
                'marquee'
            ]);
        },

        // Pick the top N issue groups to surface in Guided mode.
        // Includes hard violations AND unverified manual-review items whose rule
        // ID is in the approachable allowlist — for example, axe will flag a
        // gradient-background contrast as manual review when it can't compute
        // the ratio confidently, and that's still very much something a non-
        // developer cares about. Verified manual-review items are excluded
        // (the user already confirmed them OK). Best-practice info items stay
        // out — Guided is about what's broken.
        // Sort: severity (critical → serious → moderate → minor → unknown),
        // then node count desc.
        getGuidedTopGroups: function(limit) {
            const max = limit || 3;
            const dismissed = this.getDismissedIssues();
            const approachable = this.getApproachableRules();

            const candidates = this.issues.filter(i => {
                if (i.type === 'error') return true;
                if (i.type === 'warning' && i.uniqueId && !this.checkedItems.has(i.uniqueId)) return true;
                return false;
            });
            const grouped = this.groupIssuesByRule(candidates);

            const impactWeight = { critical: 0, serious: 1, moderate: 2, minor: 3 };
            const ranked = Object.keys(grouped)
                .filter(id => !dismissed.has(id))
                .map(id => {
                    const group = grouped[id];
                    const first = group[0];
                    const w = impactWeight[(first.impact || '').toLowerCase()];
                    return {
                        ruleId: id,
                        group: group,
                        first: first,
                        impactWeight: w == null ? 4 : w,
                        nodeCount: group.length,
                        // Strip the type suffix that groupIssuesByRule appends ("-error", etc.)
                        // so we can compare against axe rule IDs directly.
                        baseRuleId: (first.ruleId || '').toLowerCase()
                    };
                })
                .filter(entry => approachable.has(entry.baseRuleId))
                .sort((a, b) => {
                    if (a.impactWeight !== b.impactWeight) return a.impactWeight - b.impactWeight;
                    return b.nodeCount - a.nodeCount;
                });

            return ranked.slice(0, max);
        },

        // Render the guided "Top things to fix" landing into #uw-a11y-guided.
        renderGuidedView: function() {
            const guided = this.shadowRoot.getElementById('uw-a11y-guided');
            if (!guided) return;

            const PAGE = 3;
            if (this.guidedShownCount == null) this.guidedShownCount = PAGE;

            // Pull the full ranked list of approachable groups so we can
            // paginate. `Infinity` is truthy, so the existing limit logic
            // returns the full set.
            const all = this.getGuidedTopGroups(Infinity);
            const shown = Math.min(this.guidedShownCount, all.length);
            const top = all.slice(0, shown);
            const remaining = all.length - shown;
            const totalFindings = this.issues.length;

            // Count "technical-only" rule groups — issues that are real
            // candidates but were filtered out of Guided because they need
            // ARIA / markup expertise. Used to word the Advanced-view nudge.
            const candidates = this.issues.filter(i => {
                if (i.type === 'error') return true;
                if (i.type === 'warning' && i.uniqueId && !this.checkedItems.has(i.uniqueId)) return true;
                return false;
            });
            const dismissed = this.getDismissedIssues();
            const approachableSet = this.getApproachableRules();
            const grouped = this.groupIssuesByRule(candidates);
            let technicalGroupCount = 0;
            Object.keys(grouped).forEach(gid => {
                if (dismissed.has(gid)) return;
                const baseRuleId = ((grouped[gid][0] || {}).ruleId || '').toLowerCase();
                if (!approachableSet.has(baseRuleId)) technicalGroupCount++;
            });

            if (top.length === 0) {
                // Either there are zero issues to act on, or all remaining ones
                // are developer-level (ARIA wiring, landmark structure, etc.)
                // and got filtered out of Guided. Word the message accordingly.
                const candidateCount = candidates.length;
                const hasTechnicalOnly = candidateCount > 0;
                const heading = hasTechnicalOnly ? 'Nothing common to fix here' : 'Looks great';
                const body = hasTechnicalOnly
                    ? `The remaining ${candidateCount} issue${candidateCount === 1 ? '' : 's'} ${candidateCount === 1 ? 'is' : 'are'} more technical (ARIA wiring, landmark structure, and similar) and best handled by a developer.`
                    : `No automated violations were found on this page.${totalFindings > 0 ? ' You may still want to review the manual-review and best-practice items.' : ''}`;
                guided.innerHTML = `
                    <div class="uw-a11y-guided-empty${hasTechnicalOnly ? ' uw-a11y-guided-empty--neutral' : ''}">
                        <h3>${heading}</h3>
                        <p>${body}</p>
                        ${hasTechnicalOnly
                            ? `<p class="uw-a11y-guided-advanced-note">If you're comfortable editing code, <button class="uw-a11y-link-btn uw-a11y-guided-see-all" type="button">open the Advanced view</button> to see them.</p>`
                            : (totalFindings > 0
                                ? `<p class="uw-a11y-guided-advanced-note"><button class="uw-a11y-link-btn uw-a11y-guided-see-all" type="button">Open Advanced view</button> to review manual-review and best-practice items.</p>`
                                : '')}
                    </div>
                `;
                const seeAllEmpty = guided.querySelector('.uw-a11y-guided-see-all');
                if (seeAllEmpty) seeAllEmpty.addEventListener('click', () => this.setResultsViewMode('advanced'));
                return;
            }

            const cards = top.map((entry, idx) => {
                const headline = this.getFriendlyRuleHeadline(entry.first.ruleId, entry.first.title, entry.first.type);
                const count = entry.nodeCount;
                const affectsLine = count === 1
                    ? 'Affects 1 element on this page.'
                    : `Affects ${count} elements on this page.`;
                const isManual = entry.first.type === 'warning';
                const variantClass = isManual ? 'is-manual' : 'is-violation';
                // Magnifying-glass for manual review, "!" for hard violations.
                const iconHtml = isManual
                    ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
                    : '!';
                const badgeHtml = isManual
                    ? `<span class="uw-a11y-guided-card-badge">Needs review</span>`
                    : '';
                return `
                    <button type="button" class="uw-a11y-guided-card ${variantClass}" data-step="${idx}" data-rule-id="${this.escapeHtmlAttribute(entry.ruleId)}">
                        <span class="uw-a11y-guided-icon" aria-hidden="true">${iconHtml}</span>
                        <span class="uw-a11y-guided-card-text">
                            <span class="uw-a11y-guided-card-title">${this.escapeHtmlContent(headline)}</span>
                            <span class="uw-a11y-guided-card-meta">${badgeHtml}${this.escapeHtmlContent(affectsLine)}</span>
                        </span>
                        <span class="uw-a11y-guided-arrow" aria-hidden="true">→</span>
                    </button>
                `;
            }).join('');

            const moreCount = Math.min(PAGE, remaining);
            const showMoreBtn = remaining > 0
                ? `<button type="button" class="uw-a11y-link-btn uw-a11y-guided-more">Show ${moreCount} more ${moreCount === 1 ? 'issue' : 'issues'}${remaining > moreCount ? ` (${remaining} remaining)` : ''}</button>`
                : '';

            // Quieter advanced-view nudge. Only mention Advanced view in the
            // context that justifies it (technical issues remaining or, once
            // the user has paged through everything friendly, as a quiet
            // exit). Phrased so it's clear that view is for developers.
            let advancedNote = '';
            if (technicalGroupCount > 0) {
                advancedNote = `<p class="uw-a11y-guided-advanced-note">${technicalGroupCount} more technical issue${technicalGroupCount === 1 ? '' : 's'} ${technicalGroupCount === 1 ? 'requires' : 'require'} ARIA or markup-level fixes. <button type="button" class="uw-a11y-link-btn uw-a11y-guided-see-all">Open Advanced view</button> if you're comfortable editing code.</p>`;
            } else if (remaining === 0) {
                advancedNote = `<p class="uw-a11y-guided-advanced-note">Need full technical detail? <button type="button" class="uw-a11y-link-btn uw-a11y-guided-see-all">Open Advanced view</button>.</p>`;
            }

            guided.innerHTML = `
                <div class="uw-a11y-guided-wrap">
                    <div class="uw-a11y-guided-header">
                        <h3 class="uw-a11y-guided-heading">Top things to fix</h3>
                        <span class="uw-a11y-guided-count">${top.length}${all.length > top.length ? ' of ' + all.length : ''}</span>
                    </div>
                    <div class="uw-a11y-guided-cards">${cards}</div>
                    <button type="button" class="uw-a11y-guided-walkthrough" id="uw-a11y-guided-walk">
                        <svg class="uw-a11y-guided-walk-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <polyline points="3 7 5 9 9 5"/>
                            <polyline points="3 13 5 15 9 11"/>
                            <polyline points="3 19 5 21 9 17"/>
                            <line x1="13" y1="7" x2="21" y2="7"/>
                            <line x1="13" y1="13" x2="21" y2="13"/>
                            <line x1="13" y1="19" x2="21" y2="19"/>
                        </svg>
                        Walk me through these
                    </button>
                    ${showMoreBtn}
                    ${advancedNote}
                </div>
            `;

            // Card click → jump straight into walkthrough at that step
            guided.querySelectorAll('.uw-a11y-guided-card').forEach(btn => {
                btn.addEventListener('click', () => {
                    const step = parseInt(btn.dataset.step, 10) || 0;
                    this.openWalkthrough(step);
                });
            });

            const walkBtn = guided.querySelector('#uw-a11y-guided-walk');
            if (walkBtn) walkBtn.addEventListener('click', () => this.openWalkthrough(0));

            const moreBtnEl = guided.querySelector('.uw-a11y-guided-more');
            if (moreBtnEl) moreBtnEl.addEventListener('click', () => {
                this.guidedShownCount = Math.min(all.length, (this.guidedShownCount || PAGE) + PAGE);
                this.renderGuidedView();
                // Re-fit the panel height to the new content.
                if (this.currentView === 'results') {
                    const content = this.shadowRoot.getElementById('uw-a11y-content');
                    if (content) {
                        const target = this.measureViewHeight('results');
                        const max = this.getMaxContentHeight();
                        if (target) content.style.height = Math.min(target, max) + 'px';
                    }
                }
                this.playSound('ui');
            });

            const seeAll = guided.querySelector('.uw-a11y-guided-see-all');
            if (seeAll) seeAll.addEventListener('click', () => this.setResultsViewMode('advanced'));
        },

        // Render the small "Guided / Advanced" toggle pinned at the top of
        // the results view. Always visible so users can flip back and forth.
        renderResultsHeader: function() {
            const header = this.shadowRoot.getElementById('uw-a11y-results-header');
            if (!header) return;
            const mode = this.resultsViewMode || 'guided';
            header.innerHTML = `
                <div class="uw-a11y-view-toggle" role="tablist" aria-label="Results view">
                    <button type="button" role="tab" class="uw-a11y-view-toggle-btn ${mode === 'guided' ? 'is-active' : ''}" data-mode="guided" aria-selected="${mode === 'guided'}">Guided</button>
                    <button type="button" role="tab" class="uw-a11y-view-toggle-btn ${mode === 'advanced' ? 'is-active' : ''}" data-mode="advanced" aria-selected="${mode === 'advanced'}">Advanced</button>
                </div>
            `;
            header.querySelectorAll('.uw-a11y-view-toggle-btn').forEach(btn => {
                btn.addEventListener('click', () => this.setResultsViewMode(btn.dataset.mode));
            });
        },

        setResultsViewMode: function(mode) {
            const next = mode === 'advanced' ? 'advanced' : 'guided';
            if (this.resultsViewMode === next) return;
            this.resultsViewMode = next;
            const view = this.shadowRoot.getElementById('uw-a11y-view-results');
            if (view) view.setAttribute('data-results-mode', next);
            this.renderResultsHeader();
            if (next === 'guided') {
                this.closeWalkthrough(true);
                this.renderGuidedView();
            }
            this.playSound('ui');
            // Re-fit the panel height to the new content.
            if (this.currentView === 'results') {
                const content = this.shadowRoot.getElementById('uw-a11y-content');
                if (content) {
                    const target = this.measureViewHeight('results');
                    const max = this.getMaxContentHeight();
                    if (target) content.style.height = Math.min(target, max) + 'px';
                }
            }
        },

        // ── Walkthrough (one issue at a time) ──────────────────────────────
        openWalkthrough: function(startIndex) {
            // Walk through whatever is currently visible in the guided view
            // (defaults to 3 if the user hasn't expanded the list).
            const top = this.getGuidedTopGroups(this.guidedShownCount || 3);
            if (top.length === 0) return;
            this.walkthroughGroups = top;
            this.walkthroughIndex = Math.max(0, Math.min(startIndex || 0, top.length - 1));

            // Build a modal-style overlay inside the results view.
            const guided = this.shadowRoot.getElementById('uw-a11y-guided');
            if (!guided) return;
            guided.innerHTML = `<div class="uw-a11y-walkthrough" id="uw-a11y-walkthrough"></div>`;
            this.renderWalkthroughStep();
            // Auto-highlight the first instance on the page so the user
            // immediately sees what the rule is referring to. Subsequent
            // instances already auto-highlight via stepWalkthroughInstance.
            this.highlightCurrentWalkthroughInstance();
        },

        highlightCurrentWalkthroughInstance: function() {
            try {
                if (!this.walkthroughGroups) return;
                const idx = this.walkthroughIndex || 0;
                const entry = this.walkthroughGroups[idx];
                if (!entry || !entry.ruleId) return;
                this.highlightCurrentInstance(entry.ruleId, true);
            } catch (_) { /* best-effort */ }
        },

        renderWalkthroughStep: function() {
            const host = this.shadowRoot.getElementById('uw-a11y-walkthrough');
            if (!host || !this.walkthroughGroups) return;
            const idx = this.walkthroughIndex || 0;
            const total = this.walkthroughGroups.length;
            const entry = this.walkthroughGroups[idx];
            if (!entry) return;
            const first = entry.first;
            const headline = this.getFriendlyRuleHeadline(first.ruleId, first.title, first.type);
            const count = entry.nodeCount;
            const countLine = count === 1 ? '1 element' : `${count} elements`;

            // Reset the instance pointer for this rule when stepping into a new rule.
            const ruleId = entry.ruleId;
            if (this.currentInstances[ruleId] == null) this.currentInstances[ruleId] = 0;
            const instanceIdx = Math.min(this.currentInstances[ruleId], count - 1);
            this.currentInstances[ruleId] = instanceIdx;

            // Per-instance verification state for manual-review rules. Each
            // instance has its own uniqueId tracked in checkedItems.
            const currentInstance = entry.group[instanceIdx];
            const isManualReview = first.type === 'warning';
            const instanceVerified = isManualReview
                && currentInstance && currentInstance.uniqueId
                && this.checkedItems.has(currentInstance.uniqueId);
            const verifiedSoFar = isManualReview
                ? entry.group.filter(i => i.uniqueId && this.checkedItems.has(i.uniqueId)).length
                : 0;

            const instancePagerHtml = count > 1 ? `
                <div class="uw-a11y-walk-instance-pager" role="group" aria-label="Navigate instances of this issue">
                    <button type="button" class="uw-a11y-walk-instance-prev" aria-label="Previous instance" ${instanceIdx === 0 ? 'disabled' : ''}>‹</button>
                    <span class="uw-a11y-walk-instance-label">Instance <strong>${instanceIdx + 1}</strong> of ${count}${isManualReview ? ` <span class="uw-a11y-walk-instance-progress">· ${verifiedSoFar}/${count} reviewed</span>` : ''}${instanceVerified ? ' <span class="uw-a11y-walk-instance-check" aria-label="This instance is reviewed">✓</span>' : ''}</span>
                    <button type="button" class="uw-a11y-walk-instance-next" aria-label="Next instance" ${instanceIdx === count - 1 ? 'disabled' : ''}>›</button>
                </div>
            ` : '';

            host.innerHTML = `
                <div class="uw-a11y-walk-header">
                    <button type="button" class="uw-a11y-walk-back" aria-label="Back to Top things to fix">←</button>
                    <span class="uw-a11y-walk-step">Step ${idx + 1} of ${total}</span>
                    <button type="button" class="uw-a11y-walk-close" aria-label="Close walkthrough">✕</button>
                </div>
                <div class="uw-a11y-walk-body">
                    <h3 class="uw-a11y-walk-headline">
                        ${this.escapeHtmlContent(headline)}
                        ${first.type === 'warning' ? '<span class="uw-a11y-guided-card-badge uw-a11y-walk-badge">Needs review</span>' : ''}
                    </h3>
                    <p class="uw-a11y-walk-meta">Affects ${this.escapeHtmlContent(countLine)} on this page.${first.type === 'warning' ? ' Please verify each one yourself.' : ''}</p>
                    ${instancePagerHtml}
                    <div class="uw-a11y-walk-fix">
                        <strong>How to fix</strong>
                        <div class="uw-a11y-walk-fix-body">${first.recommendation ? this.decorateRecommendation(first.recommendation, first.ruleId) : this.escapeHtmlContent(first.description || '')}</div>
                    </div>
                    ${first.description && first.recommendation ? `
                        <details class="uw-a11y-walk-details">
                            <summary>Why this matters</summary>
                            <p>${this.escapeHtmlContent(first.description)}</p>
                        </details>
                    ` : ''}
                    ${first.helpUrl ? `<a class="uw-a11y-walk-learn" href="${this.escapeUrl(first.helpUrl)}" target="_blank" rel="noopener noreferrer">Learn more about this rule →</a>` : ''}
                    <div class="uw-a11y-walk-actions">
                        <button type="button" class="uw-a11y-btn uw-a11y-btn-secondary uw-a11y-walk-show">${count > 1 ? `Show instance ${instanceIdx + 1} on the page` : 'Show me on the page'}</button>
                        ${isManualReview ? `<button type="button" class="uw-a11y-btn uw-a11y-walk-verify ${instanceVerified ? 'is-verified' : ''}">${instanceVerified ? 'Reviewed ✓ — undo' : (count > 1 ? `Mark instance ${instanceIdx + 1} as reviewed` : 'Mark as reviewed')}</button>` : ''}
                    </div>
                </div>
                <div class="uw-a11y-walk-nav">
                    <button type="button" class="uw-a11y-btn uw-a11y-btn-secondary uw-a11y-walk-prev" ${idx === 0 ? 'disabled' : ''}>‹ Previous</button>
                    <button type="button" class="uw-a11y-btn uw-a11y-walk-next">${idx === total - 1 ? 'Done' : 'Next ›'}</button>
                </div>
            `;

            host.querySelector('.uw-a11y-walk-back').addEventListener('click', () => this.closeWalkthrough());
            host.querySelector('.uw-a11y-walk-close').addEventListener('click', () => this.closeWalkthrough());
            host.querySelector('.uw-a11y-walk-show').addEventListener('click', () => {
                this.highlightCurrentInstance(ruleId);
            });
            host.querySelector('.uw-a11y-walk-prev').addEventListener('click', () => this.stepWalkthrough(-1));
            host.querySelector('.uw-a11y-walk-next').addEventListener('click', () => {
                if (idx === total - 1) this.closeWalkthrough();
                else this.stepWalkthrough(1);
            });

            const instPrev = host.querySelector('.uw-a11y-walk-instance-prev');
            const instNext = host.querySelector('.uw-a11y-walk-instance-next');
            if (instPrev) instPrev.addEventListener('click', () => this.stepWalkthroughInstance(ruleId, -1));
            if (instNext) instNext.addEventListener('click', () => this.stepWalkthroughInstance(ruleId, 1));

            const verifyBtn = host.querySelector('.uw-a11y-walk-verify');
            if (verifyBtn && isManualReview && currentInstance && currentInstance.uniqueId) {
                verifyBtn.addEventListener('click', () => {
                    const uniqueId = currentInstance.uniqueId;
                    const wasVerified = this.checkedItems.has(uniqueId);
                    if (wasVerified) {
                        this.checkedItems.delete(uniqueId);
                    } else {
                        this.checkedItems.add(uniqueId);
                    }
                    sessionStorage.setItem('uw-a11y-checked', JSON.stringify(Array.from(this.checkedItems)));
                    // Keep the Advanced view's checkbox/label in lockstep so
                    // flipping over to it reflects what the user just did.
                    this.syncAdvancedRuleUI(ruleId);
                    this.updateScore();
                    this.playSound(wasVerified ? 'ui' : 'verify');

                    if (wasVerified) {
                        // Un-marked — just refresh this step so labels update.
                        this.renderWalkthroughStep();
                        return;
                    }

                    // Auto-advance to the next unverified instance in this rule.
                    let nextInstanceIdx = -1;
                    for (let j = instanceIdx + 1; j < entry.group.length; j++) {
                        const it = entry.group[j];
                        if (it && it.uniqueId && !this.checkedItems.has(it.uniqueId)) { nextInstanceIdx = j; break; }
                    }
                    if (nextInstanceIdx === -1) {
                        for (let j = 0; j < instanceIdx; j++) {
                            const it = entry.group[j];
                            if (it && it.uniqueId && !this.checkedItems.has(it.uniqueId)) { nextInstanceIdx = j; break; }
                        }
                    }
                    if (nextInstanceIdx !== -1) {
                        this.currentInstances[ruleId] = nextInstanceIdx;
                        this.highlightCurrentInstance(ruleId, true);
                        this.renderWalkthroughStep();
                        return;
                    }

                    // All instances of this rule are reviewed — advance to the next walkthrough step.
                    if (idx === total - 1) this.closeWalkthrough();
                    else this.stepWalkthrough(1);
                });
            }

            if (this.currentView === 'results') {
                const content = this.shadowRoot.getElementById('uw-a11y-content');
                if (content) {
                    const target = this.measureViewHeight('results');
                    const max = this.getMaxContentHeight();
                    if (target) content.style.height = Math.min(target, max) + 'px';
                }
            }
        },

        stepWalkthrough: function(direction) {
            if (!this.walkthroughGroups) return;
            const total = this.walkthroughGroups.length;
            const next = (this.walkthroughIndex || 0) + direction;
            if (next < 0 || next >= total) return;
            this.walkthroughIndex = next;
            this.renderWalkthroughStep();
            this.highlightCurrentWalkthroughInstance();
            this.playSound('navigate');
        },

        // Step through individual instances of the current walkthrough rule
        // (e.g. all four "input has no label" elements). Uses the same
        // currentInstances pointer as the advanced view so navigation state
        // stays consistent if the user flips modes.
        stepWalkthroughInstance: function(ruleId, direction) {
            if (!this.walkthroughGroups) return;
            const idx = this.walkthroughIndex || 0;
            const entry = this.walkthroughGroups[idx];
            if (!entry || entry.ruleId !== ruleId) return;
            const total = entry.nodeCount;
            const cur = this.currentInstances[ruleId] || 0;
            const nextIdx = cur + direction;
            if (nextIdx < 0 || nextIdx >= total) return;
            this.currentInstances[ruleId] = nextIdx;
            // Highlight the new instance immediately so the user sees the change on the page.
            this.highlightCurrentInstance(ruleId, true);
            this.playSound('navigate');
            // Re-render the step so the pager label and button text update.
            this.renderWalkthroughStep();
        },

        closeWalkthrough: function(silent) {
            this.walkthroughGroups = null;
            this.walkthroughIndex = 0;
            // Re-render guided list (only if we're still in guided mode).
            if (this.resultsViewMode === 'guided') this.renderGuidedView();
            if (!silent) this.playSound('ui');
        },

        displayResults: function() {
            const panel = this.createPanel();
            const summary = this.shadowRoot.getElementById('uw-a11y-summary');
            const results = this.shadowRoot.getElementById('uw-a11y-results');

            // Reset guided pagination on every fresh scan so reveals don't
            // carry over between unrelated pages.
            this.guidedShownCount = 3;

            // Initialize results view mode from settings on each render.
            this.resultsViewMode = this.getDefaultResultsView();
            const resultsView = this.shadowRoot.getElementById('uw-a11y-view-results');
            if (resultsView) resultsView.setAttribute('data-results-mode', this.resultsViewMode);
            this.renderResultsHeader();

            // Apply saved position for draggable panel (replaces minimize feature)
            this.applySavedPosition();
            
            // Count issues by type
            const counts = {
                error: this.issues.filter(i => i.type === 'error').length,
                warning: this.issues.filter(i => i.type === 'warning' && i.uniqueId).length, // Only count manual review items with uniqueId
                warningChecked: this.issues.filter(i => i.type === 'warning' && i.uniqueId && this.checkedItems.has(i.uniqueId)).length,
                info: this.issues.filter(i => i.type === 'info').length
            };
            
            // Update visibility of elements with if-issues class
            this.updateIfIssuesVisibility();
            

            
            // Get accessibility score
            const scoreData = this.axeResults ? this.axeResults.score : null;
            
            // Load and apply saved filter preferences
            this.loadFilters();

            // Display summary with score dial and accessibility announcements
            summary.innerHTML = `
                <!-- ARIA live region for screen reader announcements -->
                <div id="uw-a11y-announcements" aria-live="polite" aria-atomic="true" class="sr-only"></div>
                <!-- ARIA live region for highlight navigation instructions (assertive so it reads immediately after the element announcement) -->
                <div id="uw-a11y-nav-hint" aria-live="assertive" aria-atomic="true" class="sr-only"></div>
                
                ${scoreData ? this.renderScoreDial(scoreData) : ''}

                ${(() => {
                    const hintKey = this.getResultsPresetHintKey();
                    if (!hintKey) return '';
                    const preset = this.getPlatformPresets()[hintKey];
                    const presetLabel = preset.label;
                    const hintMode = preset.hintMode === 'content' ? 'content' : 'whole';
                    // Phrase the question by what the preset would actually do
                    // when applied in its hintMode. LibGuides defaults to
                    // content-only ("scope to the guide body"); WP/Drupal/etc.
                    // default to whole-page ("apply preset / exclude chrome").
                    let question;
                    const hasContentScope = !!(preset.contentScope || '').trim();
                    if (hintMode === 'content') {
                        question = `Looks like a <strong>${this.escapeHtmlContent(presetLabel)}</strong> site. Scope this scan to the ${this.escapeHtmlContent(presetLabel)} content area only?`;
                    } else if ((preset.exclude || '').trim() && !(preset.scope || '').trim()) {
                        question = `Looks like a <strong>${this.escapeHtmlContent(presetLabel)}</strong> site. Apply the preset to skip site chrome (admin bars, etc.)?`;
                    } else {
                        question = `Looks like a <strong>${this.escapeHtmlContent(presetLabel)}</strong> site. Apply the matching preset for cleaner results?`;
                    }
                    // Offer a secondary "Content only" action for content editors
                    // when the primary action is whole-page and the preset has
                    // a defined content scope.
                    const altButton = (hintMode === 'whole' && hasContentScope)
                        ? `<button type="button" class="uw-a11y-preset-hint-alt" data-preset="${this.escapeHtmlAttr(hintKey)}" data-mode="content" title="Content editor? Scan only the page content, not header/footer/sidebar">Content only</button>`
                        : '';
                    return `
                        <div id="uw-a11y-preset-hint" role="status" class="uw-a11y-preset-hint" data-preset="${this.escapeHtmlAttr(hintKey)}" data-mode="${this.escapeHtmlAttr(hintMode)}">
                            <svg class="uw-a11y-preset-hint-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                            <span class="uw-a11y-preset-hint-text">${question}</span>
                            <div class="uw-a11y-preset-hint-actions">
                                <button type="button" class="uw-a11y-preset-hint-apply" data-preset="${this.escapeHtmlAttr(hintKey)}" data-mode="${this.escapeHtmlAttr(hintMode)}">Apply</button>
                                ${altButton}
                            </div>
                            <button type="button" class="uw-a11y-preset-hint-dismiss" aria-label="Dismiss platform suggestion" title="Don't show this again on this site">✕</button>
                        </div>
                    `;
                })()}

                ${(this.getEffectiveIncludeSelectors().length > 0 || this.getActivePresetEntryForCurrentHost()) ? `
                <div role="status" style="background:rgba(79,70,229,0.07);border:1px solid rgba(79,70,229,0.25);border-radius:8px;padding:8px 12px;font-size:12px;color:#4f46e5;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                    <span>${this.getScopeBannerHtml()}</span>
                    <a href="#" data-uw-action="showView" data-uw-arg="settings" style="margin-left:auto;font-size:11px;color:inherit;text-decoration:underline;">Edit scope</a>
                </div>` : ''}

                <!-- Accessible summary section -->
                <div role="region" aria-labelledby="uw-a11y-summary-heading" class="uw-a11y-advanced-only">
                    <h3 id="uw-a11y-summary-heading" class="sr-only">Accessibility Test Results Summary</h3>

                    <p><strong>Total Issues Found:</strong> ${this.issues.length}</p>
                    
                    <div style="margin: 8px 0;" role="list" aria-label="Issue breakdown by type">
                        <div role="listitem" class="violationtype">
                            <div class="info-with-tooltip">
                                <span id="count-error" class="uw-a11y-count count-error" aria-label="${counts.error} violations requiring immediate attention">${counts.error}</span> <span class="issue-type-icon type-error">${this.getIssueTypeIcon('error','summary')}</span>Violations
                                <button class="info-btn" aria-label="What does Violations mean?" aria-describedby="tip-violations">i</button>
                                <span id="tip-violations" class="tooltip" role="tooltip">These are accessibility failures that must be fixed.</span>
                            </div>
                            <button id="toggle-errors" class="filter-toggle" aria-pressed="true" aria-label="Toggle showing violations" data-uw-action="toggleFilter" data-uw-arg="errors">
                                <svg class="filter-icon icon-eye" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
                                <svg class="filter-icon icon-eye-off" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3l18 18M10.58 10.58A3 3 0 0012 15a3 3 0 002.42-4.42M9.88 4.24A10.94 10.94 0 0112 5c7 0 11 7 11 7a18.94 18.94 0 01-5.06 5.94M6.26 6.26A18.94 18.94 0 001 12s4 7 11 7a10.94 10.94 0 004.24-.88" stroke="currentColor" stroke-width="2"/></svg>
                            </button>
                        </div>
                        <div role="listitem" class="violationtype">
                            <div class="info-with-tooltip">
                                <span id="count-warning" class="uw-a11y-count count-warning" aria-label="${counts.warning} manual review items">${counts.warning}</span> <span class="issue-type-icon type-warning">${this.getIssueTypeIcon('warning','summary')}</span>Manual Review
                                <button class="info-btn" aria-label="What does Manual Review mean?" aria-describedby="tip-manual">i</button>
                                <span id="tip-manual" class="tooltip" role="tooltip">These items need human verification.</span>
                            </div>
                            <button id="toggle-warnings" class="filter-toggle" aria-pressed="true" aria-label="Toggle showing manual review" data-uw-action="toggleFilter" data-uw-arg="warnings">
                                <svg class="filter-icon icon-eye" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
                                <svg class="filter-icon icon-eye-off" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3l18 18M10.58 10.58A3 3 0 0012 15a3 3 0 002.42-4.42M9.88 4.24A10.94 10.94 0 0112 5c7 0 11 7 11 7a18.94 18.94 0 01-5.06 5.94M6.26 6.26A18.94 18.94 0 001 12s4 7 11 7a10.94 10.94 0 004.24-.88" stroke="currentColor" stroke-width="2"/></svg>
                            </button>
                        </div>
                        <div role="listitem" class="violationtype">
                            <div class="info-with-tooltip">
                                <span id="count-info" class="uw-a11y-count count-info" aria-label="${counts.info} best-practice suggestions">${counts.info}</span> <span class="issue-type-icon type-info">${this.getIssueTypeIcon('info','summary')}</span>Best Practices
                                <button class="info-btn" aria-label="What does Best Practices mean?" aria-describedby="tip-best">i</button>
                                <span id="tip-best" class="tooltip" role="tooltip">Suggestions to improve usability and clarity.</span>
                            </div>
                            <button id="toggle-info" class="filter-toggle" aria-pressed="true" aria-label="Toggle showing best practices" data-uw-action="toggleFilter" data-uw-arg="info">
                                <svg class="filter-icon icon-eye" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
                                <svg class="filter-icon icon-eye-off" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3l18 18M10.58 10.58A3 3 0 0012 15a3 3 0 002.42-4.42M9.88 4.24A10.94 10.94 0 0112 5c7 0 11 7 11 7a18.94 18.94 0 01-5.06 5.94M6.26 6.26A18.94 18.94 0 001 12s4 7 11 7a10.94 10.94 0 004.24-.88" stroke="currentColor" stroke-width="2"/></svg>
                            </button>
                        </div>
                        ${counts.warningChecked > 0 ? `
                            <div role="listitem" class="violationtype">
                                <div>
                                    <span id="count-verified" class="uw-a11y-count count-verified" aria-label="${counts.warningChecked} verified items">${counts.warningChecked}</span>Verified
                                    <span class="sr-only"> - These manual review items have been checked and confirmed</span>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                ${this.axeResults ? `
                    <div class="axe-summary uw-a11y-advanced-only">
                        <strong>Standard:</strong> ${this.getWcagLabel()}
                    </div>
                ` : ''}
            `;
            // Animate the score dial and number on initial render
            this.startResultsScoreAnimation();

            // Wire up the platform-preset hint pill (Apply / Dismiss) if it
            // was rendered above. Apply triggers a re-scan; Dismiss writes a
            // per-hostname dismissal so we don't pester the user again.
            const presetHint = this.shadowRoot.getElementById('uw-a11y-preset-hint');
            if (presetHint) {
                const applyBtn = presetHint.querySelector('.uw-a11y-preset-hint-apply');
                const altBtn = presetHint.querySelector('.uw-a11y-preset-hint-alt');
                const dismissBtn = presetHint.querySelector('.uw-a11y-preset-hint-dismiss');
                if (applyBtn) applyBtn.addEventListener('click', () => {
                    const key = applyBtn.dataset.preset;
                    if (!key) return;
                    const mode = applyBtn.dataset.mode === 'content' ? 'content' : 'whole';
                    this.setActivePresetForCurrentHost(key, mode);
                    this.playSound('verify');
                    this.scoreAnimationPlayed = false;
                    this.runAxeChecks();
                });
                if (altBtn) altBtn.addEventListener('click', () => {
                    const key = altBtn.dataset.preset;
                    if (!key) return;
                    const mode = altBtn.dataset.mode === 'content' ? 'content' : 'whole';
                    this.setActivePresetForCurrentHost(key, mode);
                    this.playSound('verify');
                    this.scoreAnimationPlayed = false;
                    this.runAxeChecks();
                });
                if (dismissBtn) dismissBtn.addEventListener('click', () => {
                    const key = presetHint.dataset.preset;
                    if (key) this.markPresetHintDismissed(key);
                    this.playSound('ui');
                    presetHint.remove();
                });
            }

            // Add event listener for score info icon
            const scoreInfo = this.shadowRoot.querySelector('.uw-a11y-score-info');
            if (scoreInfo) {
                const handleInfoClick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showScoreExplanation();
                };
                
                scoreInfo.addEventListener('click', handleInfoClick);
                scoreInfo.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleInfoClick(e);
                    }
                });
            }
            
            // Initialize filter toggle UI state
            this.updateFilterUI();

            // Display issues
            if (this.issues.length === 0) {
                results.innerHTML = `
                    <div class="uw-a11y-issue info">
                        <h4>Excellent Accessibility!</h4>
                        <p>No accessibility violations detected by axe-core. Your page meets ${this.getWcagLabel()} automated testing standards.</p>
                        <p><strong>Next Steps:</strong> Consider manual testing with screen readers and keyboard navigation for complete accessibility validation.</p>
                    </div>
                `;
            } else {
                // Render issue list using current filters
                this.refreshIssueList();
            }

            // Always populate the guided view; CSS hides it in advanced mode.
            this.renderGuidedView();

            // Announce results to screen readers
            this.announceResults(scoreData, counts);

            // Initialize inspector tools after DOM is ready
            this.initInspectorTools();

            // Set focus to the panel for keyboard accessibility
            this.setFocusToPanel();

            // Play scan-complete chime
            this.playSound('complete');

            // Record this scan in the per-URL history (no-op when disabled in
            // settings). After recording, render the sparkline below the dial.
            try {
                if (scoreData && typeof scoreData.score === 'number') {
                    this.recordScanInHistory(scoreData.score, {
                        errors: counts.error,
                        warnings: counts.warning,
                        info: counts.info,
                        dismissed: this.getDismissedIssues().size,
                        verified: counts.warningChecked
                    }, this.collectRuleIdsForHistory(), this.getCurrentScanCfg());
                }
            } catch (e) {
                console.warn('Failed to record scan history:', e);
            }
            // Mount the sparkline (no-op if there's only 1 entry)
            this.renderScoreHistorySparkline();
        },
        

        
        // Render the accessibility score dial
        // Helper function to create gradient with multiple stops
        // Score ring geometry — must match the cx/cy/r in the rendered SVG
        scoreRingRadius: 53,
        scoreRingCircumference: function() { return 2 * Math.PI * this.scoreRingRadius; },

        // Return the gradient stop colors for a given score band.
        getScoreColors: function(score) {
            if (score >= 90) return { start: '#1e7e34', end: '#84d940' };
            if (score >= 70) return { start: '#e6a800', end: '#ffd96a' };
            if (score >= 50) return { start: '#dc6002', end: '#ff9a56' };
            return { start: '#a71e2a', end: '#ee6674' };
        },

        // Apply the score ring visuals (color + fill amount) to a score-circle element.
        // `percent01` is 0..1 (animatable). Falls back to score/100 when omitted.
        applyScoreVisual: function(scoreCircleEl, score, percent01) {
            if (!scoreCircleEl) return;
            const p = (percent01 == null) ? Math.max(0, Math.min(1, score / 100)) : Math.max(0, Math.min(1, percent01));
            const circumference = this.scoreRingCircumference();
            const progress = scoreCircleEl.querySelector('.uw-a11y-score-progress');
            const gradStart = scoreCircleEl.querySelector('.uw-a11y-score-grad-start');
            const gradEnd = scoreCircleEl.querySelector('.uw-a11y-score-grad-end');
            const colors = this.getScoreColors(score);
            if (progress) {
                progress.setAttribute('stroke-dasharray', String(circumference));
                progress.setAttribute('stroke-dashoffset', String(circumference * (1 - p)));
            }
            if (gradStart) gradStart.setAttribute('stop-color', colors.start);
            if (gradEnd) gradEnd.setAttribute('stop-color', colors.end);
        },

        // Return a consistent SVG icon for a given issue type
        // variant: 'issue' | 'summary' (controls class names)
        // Short label shown on the severity badge in the rule-group header.
        getIssueTypeLabel: function(type, isVerified) {
            if (isVerified) return 'Verified';
            if (type === 'error') return 'Error';
            if (type === 'warning') return 'Manual review';
            if (type === 'info') return 'Best practice';
            return '';
        },

        getIssueTypeIcon: function(type, variant) {
            const cls = variant === 'issue' ? 'uw-a11y-issue-icon' : '';
            const base = (extra) => extra ? `${cls} ${extra}` : cls;
            if (type === 'error') {
                // Alert triangle
                return `<svg class="${base('type-error')}" viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
            }
            if (type === 'warning') {
                // Magnifying glass (manual review)
                return `<svg class="${base('type-warning')}" viewBox="0 0 512 512" width="18" height="18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M456.69,421.39,362.6,327.3a173.81,173.81,0,0,0,34.84-104.58C397.44,126.38,319.06,48,222.72,48S48,126.38,48,222.72s78.38,174.72,174.72,174.72A173.81,173.81,0,0,0,327.3,362.6l94.09,94.09a25,25,0,0,0,35.3-35.3ZM97.92,222.72a124.8,124.8,0,1,1,124.8,124.8A124.95,124.95,0,0,1,97.92,222.72Z"/></svg>`;
            }
            // Info / Best Practices — check circle
            return `<svg class="${base('type-info')}" viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 4L12 14.01 9 11.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        },

        renderScoreDial: function(scoreData) {
            const score = scoreData.score;
            const colors = this.getScoreColors(score);
            const circumference = this.scoreRingCircumference();
            const r = this.scoreRingRadius;

            // Generate accessibility rating text
            const ratingText = score >= 97 ? 'Excellent' :
                              score >= 90 ? 'Very Good - just a few issues to address' :
                              score >= 70 ? 'Fair accessibility with room for improvement' :
                              score >= 50 ? 'Several issues to address' :
                              'Immediate attention needed';

            return `
                <div class="uw-a11y-score-container" role="region" aria-labelledby="uw-a11y-score-heading">
                    <h3 id="uw-a11y-score-heading" class="sr-only">Accessibility Score</h3>

                    <!-- Screen reader accessible score announcement -->
                    <div class="sr-only">
                        Accessibility score: ${score} out of 100. Rating: ${ratingText}
                    </div>

                    <div class="uw-a11y-score-dial" role="img" aria-label="Accessibility score ${score} out of 100, rated as ${ratingText}">
                        <div class="uw-a11y-score-circle">
                            <svg class="uw-a11y-score-svg" viewBox="0 0 120 120" aria-hidden="true">
                                <defs>
                                    <linearGradient id="uw-a11y-score-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop class="uw-a11y-score-grad-start" offset="0%" stop-color="${colors.start}"/>
                                        <stop class="uw-a11y-score-grad-end" offset="100%" stop-color="${colors.end}"/>
                                    </linearGradient>
                                </defs>
                                <circle class="uw-a11y-score-track" cx="60" cy="60" r="${r}"/>
                                <circle class="uw-a11y-score-progress" cx="60" cy="60" r="${r}" stroke="url(#uw-a11y-score-grad)" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"/>
                            </svg>
                            <div class="uw-a11y-score-inner">
                                <div class="uw-a11y-score-number" aria-hidden="true">0</div>
                                <div class="uw-a11y-score-label" aria-hidden="true">Score</div>
                            </div>
                        </div>
                        <div class="uw-a11y-score-info" 
                             role="button" 
                             tabindex="0"
                             aria-label="Score calculation information"
                             title="Score is calculated from failed accessibility rules. Critical issues: -25 points, Serious: -15 points, Moderate: -8 points, Minor: -3 points. Manual review items deduct half points if unverified. Category caps prevent single areas from dominating the score.">
                            <span aria-hidden="true">ⓘ</span>
                        </div>
                    </div>
                    <div style="font-size: 14px;">
                        <span style="font-size: 12px; color: #666;" aria-hidden="true">
                            ${ratingText}
                        </span>
                    </div>
                    <div id="uw-a11y-score-sparkline" class="uw-a11y-score-sparkline" style="display:none;"></div>
                </div>
            `;
        },

        // Animate the results score dial fill and count-up
        startResultsScoreAnimation: function() {
            try {
                // Guard: only animate once per session
                if (this.scoreAnimationPlayed) return;
                const scoreObj = this.axeResults && this.axeResults.score ? this.axeResults.score : null;
                if (!scoreObj) return;
                const finalScore = Math.max(0, Math.min(100, parseInt(scoreObj.score, 10) || 0));
                const scoreDial = this.shadowRoot.querySelector('.uw-a11y-score-dial');
                const scoreCircle = this.shadowRoot.querySelector('.uw-a11y-score-circle');
                const scoreNumber = this.shadowRoot.querySelector('.uw-a11y-score-number');
                if (!scoreCircle || !scoreNumber || !scoreDial) return;

                // Helper: paint the final state without animating (used for
                // reduced-motion users and as a fallback if the animation
                // never runs).
                const paintFinal = () => {
                    scoreNumber.textContent = String(finalScore);
                    this.applyScoreVisual(scoreCircle, finalScore, finalScore / 100);
                    const ratingText = finalScore >= 97 ? 'Excellent' :
                        finalScore >= 90 ? 'Very Good - just a few issues to address' :
                        finalScore >= 70 ? 'Good accessibility with room for improvement' :
                        finalScore >= 50 ? 'Fair accessibility - several issues to address' :
                        'Immediate attention needed';
                    scoreDial.setAttribute('aria-label', `Accessibility score ${finalScore} out of 100, rated as ${ratingText}`);
                };

                // Respect prefers-reduced-motion, but still show the final
                // value — earlier versions returned without painting, leaving
                // the dial stuck at 0.
                if (this.prefersReducedMotion()) {
                    this.scoreAnimationPlayed = true;
                    paintFinal();
                    return;
                }

                // Mark as played now to avoid double-starts if called rapidly
                this.scoreAnimationPlayed = true;

                // Reset start state
                scoreNumber.textContent = '0';
                this.applyScoreVisual(scoreCircle, finalScore, 0);

                // Kill prior animation if any
                if (this._scoreTween && window.gsap) {
                    this._scoreTween.kill();
                    this._scoreTween = null;
                }

                const updateAria = (val) => {
                    const current = Math.round(val);
                    const ratingText = current >= 97 ? 'Excellent' :
                        current >= 90 ? 'Very Good - just a few issues to address' :
                        current >= 70 ? 'Good accessibility with room for improvement' :
                        current >= 50 ? 'Fair accessibility - several issues to address' :
                        'Immediate attention needed';
                    scoreDial.setAttribute('aria-label', `Accessibility score ${current} out of 100, rated as ${ratingText}`);
                };

                if (window.gsap) {
                    const state = { n: 0, p: 0 };
                    this._scoreTween = window.gsap.to(state, {
                        n: finalScore,
                        p: finalScore / 100,
                        duration: 1.2,
                        ease: 'power2.out',
                        onUpdate: () => {
                            const currentScore = Math.round(state.n);
                            scoreNumber.textContent = String(currentScore);
                            // Use currentScore for color banding and state.p for ring fill
                            this.applyScoreVisual(scoreCircle, currentScore, state.p);
                            updateAria(state.n);
                        }
                    });
                } else {
                    // Simple JS fallback
                    const start = performance.now();
                    const dur = 1200;
                    const step = (t) => {
                        const p = Math.min(1, (t - start) / dur);
                        const val = Math.round(finalScore * p);
                        const fillP = (finalScore / 100) * p;
                        scoreNumber.textContent = String(val);
                        this.applyScoreVisual(scoreCircle, val, fillP);
                        updateAria(val);
                        if (p < 1) requestAnimationFrame(step);
                    };
                    requestAnimationFrame(step);
                }
            } catch (e) {
                // Non-fatal; animation is cosmetic
                console.warn('Score animation failed:', e);
            }
        },
        
        // Render detailed technical information
        renderDetailedInfo: function(detailedInfo) {
            return detailedInfo.map(detail => {
                let value = detail.value;
                
                // Special formatting for different types
                if (detail.type === 'colors' && typeof value === 'object') {
                    const unsampledNote = value.overlapsUnsampledImage
                        ? `<div style="margin-top: 0.5rem; padding: 0.4rem 0.6rem; background: #fff8e1; border-left: 3px solid #f59e0b; border-radius: 2px; font-size: 0.85em; color: #6b4c00;">
                               <strong>Background image not sampled:</strong> The background appears to be set via a CSS <code>background-image</code> on an ancestor element (e.g. a hero banner). Browsers block cross-origin pixel sampling of such images, so the actual background color could not be determined. Manual inspection is required to verify contrast.
                           </div>`
                        : '';
                    value = `
                        <div style="margin: 0.5rem 0;">
                            <div><strong>Foreground:</strong> <span style="background: ${value.foreground}; color: white; padding: 2px 6px; border-radius: 2px;">${value.foreground}</span></div>
                            <div><strong>Background:</strong> <span style="background: ${value.background}; border: 1px solid #ccc; padding: 2px 6px; border-radius: 2px;">${value.background}</span></div>
                            <div><strong>Contrast Ratio:</strong> ${value.contrast}</div>
                            <div><strong>Requirement:</strong> ${value.required}</div>
                            ${unsampledNote}
                        </div>
                    `;
                } else if (typeof value === 'string') {
                    // Only escape problematic characters that could break HTML structure
                    // But preserve basic text formatting
                    value = value
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/"/g, "&quot;");
                }
                
                return `
                    <div class="uw-a11y-details-item">
                        <div class="uw-a11y-details-label">${detail.label}:</div>
                        <div class="uw-a11y-details-value">${value}</div>
                    </div>
                `;
            }).join('');
        },
        
        // Group issues by rule ID and type for better organization
        groupIssuesByRule: function(issues) {
            const grouped = {};
            issues.forEach(issue => {
                // Use the issue's existing ruleId directly to prevent conflicts
                // Only fall back to title-based ID if ruleId is truly missing
                const baseRuleId = issue.ruleId || `fallback-${issue.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${issue.id}`;
                
                // Include type in the grouping key to separate violations from manual review items
                const ruleId = `${baseRuleId}-${issue.type}`;
                
                if (!grouped[ruleId]) {
                    grouped[ruleId] = [];
                }
                grouped[ruleId].push(issue);
            });
            return grouped;
        },

        // Initialize current instance tracking
        currentInstances: {},

        // Navigate between instances of the same rule
        navigateInstance: function(ruleId, direction) {
            if (!this.currentInstances[ruleId]) {
                this.currentInstances[ruleId] = 0;
            }
            
            const groupedIssues = this.groupIssuesByRule(this.issues);
            const issueGroup = groupedIssues[ruleId];
            
            if (!issueGroup) return;
            
            const currentIndex = this.currentInstances[ruleId];
            const newIndex = currentIndex + direction;
            
            if (newIndex >= 0 && newIndex < issueGroup.length) {
                this.currentInstances[ruleId] = newIndex;
                this.updateInstanceDisplay(ruleId, issueGroup);
                this.highlightCurrentInstance(ruleId, true); // silent — navigate already plays its own sound
                this.playSound('navigate');
            }
        },

        // Update the display for the current instance
        updateInstanceDisplay: function(ruleId, issueGroup) {
            const currentIndex = this.currentInstances[ruleId] || 0;
            const currentIssue = issueGroup[currentIndex];
            const sanitizedRuleId = this.sanitizeHtmlId(ruleId);

            // Update displayed content
            const descElement = this.shadowRoot.getElementById(`description-${sanitizedRuleId}`);
            const recElement = this.shadowRoot.getElementById(`recommendation-${sanitizedRuleId}`);
            const currentSpan = this.shadowRoot.getElementById(`current-${sanitizedRuleId}`);
            const detailedContent = this.shadowRoot.getElementById(`detailed-content-${sanitizedRuleId}`);

            if (descElement) descElement.textContent = currentIssue.description.split('\n')[0];
            if (recElement) recElement.innerHTML = this.decorateRecommendation(currentIssue.recommendation, currentIssue.ruleId);
            if (currentSpan) currentSpan.textContent = currentIndex + 1;
            if (detailedContent && currentIssue.detailedInfo) {
                detailedContent.innerHTML = this.renderDetailedInfo(currentIssue.detailedInfo);
            }

            // Update navigation buttons
            const prevBtn = this.shadowRoot.getElementById(`prev-${sanitizedRuleId}`);
            const nextBtn = this.shadowRoot.getElementById(`next-${sanitizedRuleId}`);

            if (prevBtn) prevBtn.disabled = currentIndex === 0;
            if (nextBtn) nextBtn.disabled = currentIndex === issueGroup.length - 1;

            // Per-instance verification: keep the checkbox + label tied to the
            // instance the user just navigated to (manual-review rules only).
            this.syncAdvancedRuleUI(ruleId);
        },

        // Highlight the current instance of a rule
        highlightCurrentInstance: function(ruleId, silent) {
            if (!silent) this.playSound('ui');
            // Remove previous highlights
            document.querySelectorAll('.uw-a11y-highlight').forEach(el => {
                el.classList.remove('uw-a11y-highlight');
            });
            
            const groupedIssues = this.groupIssuesByRule(this.issues);
            const issueGroup = groupedIssues[ruleId];
            
            if (!issueGroup) return;
            
            const currentIndex = this.currentInstances[ruleId] || 0;
            const currentIssue = issueGroup[currentIndex];
            
            // Resolve element if our reference is stale
            let el = currentIssue.element;
            if (!el || !(el instanceof Element) || !el.isConnected) {
                if (currentIssue.selector) {
                    try {
                        const found = document.querySelector(currentIssue.selector);
                        if (found) {
                            el = found;
                            currentIssue.element = found; // update cache
                        }
                    } catch (_) { /* ignore */ }
                }
            }
            
            if (el && el instanceof Element) {
                // Reveal hidden ancestors temporarily
                const cleanupReveal = this.ensureElementVisible(el);
                // Add highlight and focus
                el.classList.add('uw-a11y-highlight');
                const needsTempTabIndex = !el.matches('a, button, input, textarea, select, [tabindex], [contenteditable="true"]');
                if (needsTempTabIndex) {
                    el.setAttribute('tabindex', '-1');
                    el.setAttribute('data-uw-a11y-temp-tabindex', '');
                }
                try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
                // Scroll into center for visibility
                try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { /* ignore */ }

                // ── Screen reader navigation: Escape returns focus to the issue card ──
                // Remove any previous handler before setting a new one
                if (this._highlightEscHandler) {
                    document.removeEventListener('keydown', this._highlightEscHandler, true);
                    this._highlightEscHandler = null;
                }
                this._highlightRuleId = ruleId;
                this._highlightEscHandler = (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        this.returnFocusToPanel(this._highlightRuleId);
                    }
                };
                document.addEventListener('keydown', this._highlightEscHandler, true);

                // Announce navigation instructions after a short delay so the screen
                // reader finishes announcing the newly-focused element first.
                setTimeout(() => {
                    const navHint = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-nav-hint');
                    if (navHint) {
                        navHint.textContent = 'Element highlighted on page. Press Escape to return to the Pinpoint results list.';
                        // Clear after a moment so repeated highlights re-trigger the announcement
                        setTimeout(() => { navHint.textContent = ''; }, 4000);
                    }
                }, 700);

                // Cleanup highlight + revealed-ancestor undo after the
                // user-configured duration. duration === 0 means "persist
                // until the user picks another issue or clicks elsewhere".
                if (this._highlightCleanupTimer) {
                    clearTimeout(this._highlightCleanupTimer);
                    this._highlightCleanupTimer = null;
                }
                if (this._highlightAwayHandler) {
                    document.removeEventListener('mousedown', this._highlightAwayHandler, true);
                    this._highlightAwayHandler = null;
                }

                const cleanup = () => {
                    if (el && el.classList) el.classList.remove('uw-a11y-highlight');
                    if (el && el.hasAttribute && el.hasAttribute('data-uw-a11y-temp-tabindex')) {
                        el.removeAttribute('tabindex');
                        el.removeAttribute('data-uw-a11y-temp-tabindex');
                    }
                    try { if (typeof cleanupReveal === 'function') cleanupReveal(); } catch (_) { /* ignore */ }
                };

                const duration = this.getHighlightDuration();
                if (duration > 0) {
                    this._highlightCleanupTimer = setTimeout(cleanup, duration);
                } else {
                    // Persist until user clicks somewhere that isn't the
                    // highlighted element itself or the Pinpoint UI.
                    this._highlightAwayHandler = (ev) => {
                        const t = ev.target;
                        if (!t) return;
                        if (el && (t === el || (el.contains && el.contains(t)))) return;
                        const container = document.getElementById('uw-a11y-container');
                        if (container && (t === container || container.contains(t))) return;
                        document.removeEventListener('mousedown', this._highlightAwayHandler, true);
                        this._highlightAwayHandler = null;
                        cleanup();
                    };
                    document.addEventListener('mousedown', this._highlightAwayHandler, true);
                }
            }
        },

        // Return keyboard focus to the issue card in the panel after inspecting a highlighted element.
        // Called when the user presses Escape while focus is anywhere on the page.
        returnFocusToPanel: function(ruleId) {
            // Remove highlight from any highlighted elements
            document.querySelectorAll('.uw-a11y-highlight').forEach(highlighted => {
                highlighted.classList.remove('uw-a11y-highlight');
                if (highlighted.hasAttribute('data-uw-a11y-temp-tabindex')) {
                    highlighted.removeAttribute('tabindex');
                    highlighted.removeAttribute('data-uw-a11y-temp-tabindex');
                }
            });

            // Remove the Escape key handler
            if (this._highlightEscHandler) {
                document.removeEventListener('keydown', this._highlightEscHandler, true);
                this._highlightEscHandler = null;
            }
            this._highlightRuleId = null;

            // Return focus to the issue card that was activated
            const issueCard = ruleId && this.shadowRoot && this.shadowRoot.getElementById('issue-' + this.sanitizeHtmlId(ruleId));
            if (issueCard) {
                issueCard.focus();
                issueCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                // Fall back to the panel itself
                const panel = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-panel');
                if (panel) panel.focus();
            }

            // Announce the return so screen readers confirm the navigation
            const navHint = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-nav-hint');
            if (navHint) {
                navHint.textContent = 'Returned to Pinpoint results list.';
                setTimeout(() => { navHint.textContent = ''; }, 3000);
            }
        },

        // Check if all instances of a rule are verified
        isRuleVerified: function(ruleId) {
            const groupedIssues = this.groupIssuesByRule(this.issues);
            const issueGroup = groupedIssues[ruleId];
            
            if (!issueGroup) return false;
            
            return issueGroup.every(issue => 
                issue.uniqueId && this.checkedItems.has(issue.uniqueId)
            );
        },

        // Toggle verification for all instances of a rule
        toggleRuleVerification: function(ruleId) {
            const groupedIssues = this.groupIssuesByRule(this.issues);
            const issueGroup = groupedIssues[ruleId];

            if (!issueGroup) return;

            const isCurrentlyVerified = this.isRuleVerified(ruleId);

            issueGroup.forEach(issue => {
                if (issue.uniqueId) {
                    if (isCurrentlyVerified) {
                        this.checkedItems.delete(issue.uniqueId);
                    } else {
                        this.checkedItems.add(issue.uniqueId);
                    }
                }
            });

            this.syncAdvancedRuleUI(ruleId);

            // Update score and save state
            this.updateScore();
            sessionStorage.setItem('uw-a11y-checked', JSON.stringify(Array.from(this.checkedItems)));

            // Sound feedback
            const newVerificationState = this.isRuleVerified(ruleId);
            this.playSound(newVerificationState ? 'verify' : 'ui');
        },

        // ── Per-instance verification helpers (Advanced view) ─────────────
        // The Advanced view used to have a single "Mark all N instances as
        // verified" checkbox per rule. It now mirrors the Guided walkthrough:
        // the checkbox tracks the *current* instance shown by the Prev/Next
        // pager, with a "X of N reviewed" progress indicator beside it.

        isInstanceVerifiedAt: function(issueGroup, idx) {
            const issue = issueGroup && issueGroup[idx];
            return !!(issue && issue.uniqueId && this.checkedItems.has(issue.uniqueId));
        },

        countVerifiedInGroup: function(issueGroup) {
            if (!Array.isArray(issueGroup)) return 0;
            let n = 0;
            for (const i of issueGroup) {
                if (i && i.uniqueId && this.checkedItems.has(i.uniqueId)) n++;
            }
            return n;
        },

        getInstanceCheckLabel: function(issueGroup, idx) {
            const verified = this.isInstanceVerifiedAt(issueGroup, idx);
            const multi = Array.isArray(issueGroup) && issueGroup.length > 1;
            if (multi) {
                return verified
                    ? `Instance ${idx + 1} verified ✓`
                    : `Mark instance ${idx + 1} as verified`;
            }
            return verified ? 'Manually verified ✓' : 'Mark as verified';
        },

        // Toggle verification for the instance currently shown in the
        // Advanced view's pager. Auto-advances to the next unverified instance
        // on mark (matching the Guided walkthrough behavior).
        toggleInstanceVerification: function(ruleId) {
            const groupedIssues = this.groupIssuesByRule(this.issues);
            const issueGroup = groupedIssues[ruleId];
            if (!issueGroup || issueGroup.length === 0) return;

            const idx = Math.min(this.currentInstances[ruleId] || 0, issueGroup.length - 1);
            const issue = issueGroup[idx];
            if (!issue || !issue.uniqueId) return;

            const wasVerified = this.checkedItems.has(issue.uniqueId);
            if (wasVerified) {
                this.checkedItems.delete(issue.uniqueId);
            } else {
                this.checkedItems.add(issue.uniqueId);
            }
            sessionStorage.setItem('uw-a11y-checked', JSON.stringify(Array.from(this.checkedItems)));
            this.updateScore();
            this.playSound(wasVerified ? 'ui' : 'verify');

            // On mark (not unmark), advance to the next unverified instance
            // so the pager + checkbox reflect the next thing to review.
            if (!wasVerified && issueGroup.length > 1) {
                let nextIdx = -1;
                for (let j = idx + 1; j < issueGroup.length; j++) {
                    const it = issueGroup[j];
                    if (it && it.uniqueId && !this.checkedItems.has(it.uniqueId)) { nextIdx = j; break; }
                }
                if (nextIdx === -1) {
                    for (let j = 0; j < idx; j++) {
                        const it = issueGroup[j];
                        if (it && it.uniqueId && !this.checkedItems.has(it.uniqueId)) { nextIdx = j; break; }
                    }
                }
                if (nextIdx !== -1) {
                    this.currentInstances[ruleId] = nextIdx;
                    this.updateInstanceDisplay(ruleId, issueGroup);
                    this.highlightCurrentInstance(ruleId, true);
                }
            }

            this.syncAdvancedRuleUI(ruleId);
        },

        // Reflect the current verification state of a rule onto the Advanced
        // view's existing DOM (checkbox, label, progress, "checked" card class).
        // Used by per-instance toggles in either view so the two stay in sync
        // without re-rendering the whole Advanced list. The checkbox now tracks
        // the *current* instance shown by the pager; the card-level "checked"
        // class still flips on only when *every* instance is verified.
        syncAdvancedRuleUI: function(ruleId) {
            const sanitizedRuleId = this.sanitizeHtmlId(ruleId);
            const checkbox = this.shadowRoot.getElementById(`check-${sanitizedRuleId}`);
            const label = this.shadowRoot.getElementById(`check-label-${sanitizedRuleId}`);
            const progress = this.shadowRoot.getElementById(`progress-${sanitizedRuleId}`);
            const issueDiv = this.shadowRoot.getElementById(`issue-${sanitizedRuleId}`);
            const groupedIssues = this.groupIssuesByRule(this.issues);
            const issueGroup = groupedIssues[ruleId];
            if (!issueGroup) return;

            const idx = Math.min(this.currentInstances[ruleId] || 0, issueGroup.length - 1);
            const instanceVerified = this.isInstanceVerifiedAt(issueGroup, idx);
            const allVerified = this.isRuleVerified(ruleId);

            if (checkbox) checkbox.checked = instanceVerified;
            if (label) label.textContent = this.getInstanceCheckLabel(issueGroup, idx);
            if (progress) progress.textContent = `${this.countVerifiedInGroup(issueGroup)} of ${issueGroup.length} reviewed`;
            if (issueDiv) {
                if (allVerified) issueDiv.classList.add('checked');
                else issueDiv.classList.remove('checked');
            }
        },

        // Toggle detailed information display
        toggleDetails: function(ruleId) {
            const sanitizedRuleId = this.sanitizeHtmlId(ruleId);
            const detailsElement = this.shadowRoot.getElementById(`details-${sanitizedRuleId}`);
            const button = detailsElement.previousElementSibling;

            if (detailsElement.classList.contains('expanded')) {
                detailsElement.classList.remove('expanded');
                // Update only the text portion, preserving the icon
                this.updateButtonText(button, 'Show technical details');
            } else {
                detailsElement.classList.add('expanded');
                // Update only the text portion, preserving the icon
                this.updateButtonText(button, 'Hide technical details');
            }
            this.playSound('ui');
        },
        
        // Helper function to update button text while preserving icon
        updateButtonText: function(button, newText) {
            // Find the text node in the button (it's the last child that's a text node)
            const childNodes = button.childNodes;
            for (let i = childNodes.length - 1; i >= 0; i--) {
                const node = childNodes[i];
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                    node.textContent = newText;
                    return;
                }
            }
            
            // If no text node found, append the text (fallback)
            button.appendChild(document.createTextNode(newText));
        },

        // Toggle manual verification checkbox
        toggleManualCheck: function(uniqueId) {
            if (this.checkedItems.has(uniqueId)) {
                this.checkedItems.delete(uniqueId);
            } else {
                this.checkedItems.add(uniqueId);
            }
            
            // Update the label text
            const checkbox = this.shadowRoot.getElementById(`check-${uniqueId}`);
            const label = checkbox.parentNode.querySelector('.uw-a11y-check-label');
            const issueDiv = checkbox.closest('.uw-a11y-issue');
            
            if (this.checkedItems.has(uniqueId)) {
                label.textContent = 'Manually verified ✓';
                issueDiv.classList.add('checked');
            } else {
                label.textContent = 'Mark as manually verified';
                issueDiv.classList.remove('checked');
            }
            
            // Recalculate and update the score
            this.updateScore();
            
            // Store in sessionStorage for persistence during the session
            sessionStorage.setItem('uw-a11y-checked', JSON.stringify(Array.from(this.checkedItems)));
        },

        // Update the accessibility score display
        updateScore: function() {
            if (!this.filteredAxeResults) return;
            
            const newScore = this.calculateAccessibilityScore(this.filteredAxeResults);
            this.axeResults.score = newScore;
            
            // Update the score display
            const scoreNumber = this.shadowRoot.querySelector('.uw-a11y-score-number');
            const scoreCircle = this.shadowRoot.querySelector('.uw-a11y-score-circle');
            
            if (scoreNumber && scoreCircle) {
                scoreNumber.textContent = newScore.score;
                this.applyScoreVisual(scoreCircle, newScore.score);
            }
            
            // Update the counts
            const counts = {
                error: this.issues.filter(i => i.type === 'error').length,
                warning: this.issues.filter(i => i.type === 'warning' && i.uniqueId).length, // Only count manual review with uniqueId
                warningChecked: this.issues.filter(i => i.type === 'warning' && i.uniqueId && this.checkedItems.has(i.uniqueId)).length,
                info: this.issues.filter(i => i.type === 'info').length
            };
            
            // Update count display numbers without removing toggles
            const setText = (id, value) => {
                const el = this.shadowRoot.getElementById(id);
                if (el) el.textContent = value;
            };
            setText('count-error', counts.error);
            setText('count-warning', counts.warning);
            setText('count-info', counts.info);
            setText('count-verified', counts.warningChecked);
            
            // Update visibility of if-issues elements
            this.updateIfIssuesVisibility();
            
            // Announce score update to screen readers
            const announcements = this.shadowRoot.getElementById('uw-a11y-announcements');
            if (announcements && counts.warningChecked > 0) {
                const message = `Score updated to ${newScore.score}. ${counts.warningChecked} item${counts.warningChecked === 1 ? '' : 's'} verified.`;
                announcements.textContent = message;
            }
        },

        // Load checked items from sessionStorage
        loadCheckedItems: function() {
            try {
                const stored = sessionStorage.getItem('uw-a11y-checked');
                if (stored) {
                    this.checkedItems = new Set(JSON.parse(stored));
                }
            } catch (e) {
                console.warn('Could not load checked items from sessionStorage:', e);
            }
        },

        // Toggle minimize state
        toggleMinimize: function() {
            const panel = this.shadowRoot.getElementById('uw-a11y-panel');
            const minimizeBtn = this.shadowRoot.getElementById('uw-a11y-minimize');
            
            if (!panel || !minimizeBtn) return;
            
            this.isMinimized = !this.isMinimized;
            
            if (this.isMinimized) {
                panel.classList.add('minimized');
                minimizeBtn.textContent = '+';
                minimizeBtn.title = 'Restore';
            } else {
                panel.classList.remove('minimized');
                minimizeBtn.textContent = '−';
                minimizeBtn.title = 'Minimize';
                // Set focus when restoring for keyboard users
                this.setFocusToPanel();
            }
            
            // Store minimize state in sessionStorage
            sessionStorage.setItem('uw-a11y-minimized', this.isMinimized);
        },

        // Load minimize state from sessionStorage
        loadMinimizeState: function() {
            try {
                const stored = sessionStorage.getItem('uw-a11y-minimized');
                if (stored === 'true') {
                    // Delay to ensure DOM is ready
                    setTimeout(() => {
                        this.toggleMinimize();
                    }, 100);
                }
            } catch (e) {
                console.warn('Could not load minimize state from sessionStorage:', e);
            }
        },

        // Check for updates
        checkForUpdates: function() {
            // Skip update checks in extension context to avoid CSP issues
            if (this.isRunningInExtension()) {
                console.log('🔄 Update check skipped (running in extension context)');
                return;
            }
            
            // Only check once per session to avoid spam
            if (sessionStorage.getItem('uw-a11y-update-checked')) {
                return;
            }
            
            sessionStorage.setItem('uw-a11y-update-checked', 'true');
            
            // Fetch latest version info from GitHub (bookmarklet only)
            fetch('https://api.github.com/repos/Heroic-Pixel/Pinpoint-Accessibility-Checker/releases/latest')
                .then(response => response.json())
                .then(data => {
                    const latestVersion = data.tag_name.replace('v', '');
        
                    if (this.compareVersions(latestVersion, this.version) > 0) {
                        this.showUpdateNotification(latestVersion, data.html_url);
                    }
                })
                .catch(error => {
                    // Silently fail - don't bother users with update check errors
                    console.log('Update check failed (this is normal in some contexts):', error.message);
                });
        },
        
        // Check if we're running in a browser extension context
        isRunningInExtension: function() {
            // Check if axe or GSAP are already loaded (indicates pre-loading by extension)
            return window.axe || window.gsap || 
                   (window.chrome && window.chrome.runtime && window.chrome.runtime.getURL);
        },

        // Compare version strings (returns 1 if a > b, -1 if a < b, 0 if equal)
        compareVersions: function(a, b) {
            const partsA = a.split('.').map(Number);
            const partsB = b.split('.').map(Number);
            
            for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
                const partA = partsA[i] || 0;
                const partB = partsB[i] || 0;
                
                if (partA > partB) return 1;
                if (partA < partB) return -1;
            }
            return 0;
        },

        // Hide the update-available notification (data-uw-action handler)
        dismissUpdateNotification: function() {
            const note = this.shadowRoot && this.shadowRoot.getElementById('uw-a11y-update-notification');
            if (note) note.style.display = 'none';
        },

        // Show update notification
        showUpdateNotification: function(newVersion, releaseUrl) {
            const notification = document.createElement('div');
            notification.id = 'uw-a11y-update-notification';
            notification.innerHTML = `
                <div style="background: #56ab30; color: white; padding: 12px; border-radius: 4px; margin-bottom: 10px; font-size: 13px; position: relative;">
                    <button data-uw-action="dismissUpdateNotification"
                            class="uw-a11y-update-close"
                            style="position: absolute; top: 8px; right: 8px; background: none; border: none; color: white; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; opacity: 0.8; transition: opacity 0.2s, background-color 0.2s;">
                        ✕
                    </button>
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
                            <path d="M12 2L15.09 8.26L22 9L17 14L18.18 21L12 17.77L5.82 21L7 14L2 9L8.91 8.26L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                            <circle cx="12" cy="12" r="1" fill="currentColor"/>
                        </svg>
                        <h3 style="font-size: 14px; margin: 0; font-weight: 700;">Update Available</h3>
                    </div>
                    <div style="margin-bottom: 8px;">v${this.version} → v${newVersion}</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 16px;">
                        <a href="${releaseUrl}" target="_blank" style="color: #ffffff; text-decoration: underline; font-size: 12px;">
                            View release notes →
                        </a>
                        <a href="${this.websiteUrl}" target="_blank" style="color: #ffffff; text-decoration: underline; font-size: 12px;">
                            Get latest bookmarklet →
                        </a>
                    </div>
                    ${this.legacyDomainUrl ? `
                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.3); font-size: 11px; opacity: 0.9;">
                        <strong>🚀 We've moved!</strong> New domain: <a href="${this.websiteUrl}" target="_blank" style="color: #ffffff; text-decoration: underline;">pinpoint.heroicpixel.com</a><br>
                        <span style="font-size: 10px; opacity: 0.8;">Links will automatically redirect to our new home.</span>
                    </div>
                    ` : ''}
                </div>
            `;
            
            // Insert at the top of the summary section
            setTimeout(() => {
                const summary = this.shadowRoot?.getElementById('uw-a11y-summary');
                if (summary) {
                    summary.insertBefore(notification, summary.firstChild);
                }
            }, 500);
        },

        // ── Sound System ──────────────────────────────────────────────────────
        // Generates subtle UI sounds via Web Audio API (no external resources).
        // Respects prefers-reduced-motion: sounds are kept but can be toggled.
        // Types: 'ui' | 'navigate' | 'verify' | 'complete'
        playSound: function(type) {
            try {
                // Respect a localStorage mute preference (future settings hook)
                if (localStorage.getItem('uw-a11y-sounds') === 'off') return;
                const AudioCtx = window.AudioContext || window['webkitAudioContext'];
                if (!AudioCtx) return;
                const ctx = new AudioCtx();

                const play = (freq, startTime, duration, gain, wave) => {
                    const osc = ctx.createOscillator();
                    const amp = ctx.createGain();
                    osc.connect(amp);
                    amp.connect(ctx.destination);
                    osc.type = wave || 'sine';
                    osc.frequency.setValueAtTime(freq, startTime);
                    amp.gain.setValueAtTime(0, startTime);
                    amp.gain.linearRampToValueAtTime(gain, startTime + 0.01);
                    amp.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
                    osc.start(startTime);
                    osc.stop(startTime + duration + 0.01);
                };

                const t = ctx.currentTime;

                if (type === 'ui') {
                    // Short, crisp click — 880 Hz triangle, 55 ms
                    play(880, t, 0.055, 0.038, 'triangle');

                } else if (type === 'navigate') {
                    // Quick upward chirp — 540 → 820 Hz
                    const osc = ctx.createOscillator();
                    const amp = ctx.createGain();
                    osc.connect(amp);
                    amp.connect(ctx.destination);
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(540, t);
                    osc.frequency.linearRampToValueAtTime(820, t + 0.07);
                    amp.gain.setValueAtTime(0, t);
                    amp.gain.linearRampToValueAtTime(0.04, t + 0.01);
                    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
                    osc.start(t);
                    osc.stop(t + 0.13);

                } else if (type === 'verify') {
                    // Two-note positive chime — C5 then E5
                    play(523, t,        0.12, 0.05, 'sine');
                    play(659, t + 0.10, 0.14, 0.05, 'sine');

                } else if (type === 'complete') {
                    // Three-note ascending success chime — E5, G5, B5
                    play(659, t,        0.18, 0.055, 'sine');
                    play(784, t + 0.14, 0.18, 0.055, 'sine');
                    play(988, t + 0.28, 0.30, 0.06,  'sine');
                }

                // Auto-close context after sounds finish
                setTimeout(() => { try { ctx.close(); } catch(_) {} }, 800);
            } catch (_) {
                // Silently fail — sounds are purely cosmetic
            }
        },


        remove: function() {
            // Clean up element picker if active
            this.stopPickerMode();

            // Restore page layout if we were docked
            document.body.removeAttribute('data-uw-a11y-dock');

            // Note: data-pinpoint-scope attributes are intentionally left on the
            // page so a saved scope selector still resolves the next time Pinpoint
            // is opened. They have no visual or behavioral effect on the page, and
            // are cleared explicitly by the "Clear scan scope" button in Settings.

            // Clean up tab order visualization
            this.hideTabOrderVisualization();

            // Clean up focus indicators visualization
            this.hideFocusIndicatorsVisualization();

            // Clean up landmark structure visualization
            this.hideLandmarkStructureVisualization();

            // Clean up color blindness simulation
            this.removeColorBlindnessSimulation();

            // Clean up alt text overlay
            this.hideAltTextOverlay();
            this.removeAltTextOverlayStyles();
            
            // Clean up injected styles
            this.removeTabOrderStyles();
            this.removeFocusSimulationStyles();
            this.removeLandmarkStructureStyles();
            
            // Clean up any remaining timeouts
            if (this.tabOrderRefreshTimeout) {
                clearTimeout(this.tabOrderRefreshTimeout);
                this.tabOrderRefreshTimeout = null;
            }
            
            // Clean up event handlers
            this.cleanupTabOrderEventHandlers();
            this.cleanupFocusIndicatorsEventHandlers();
            this.cleanupLandmarkStructureEventHandlers();

            // Clean up highlight Escape handler if active
            if (this._highlightEscHandler) {
                document.removeEventListener('keydown', this._highlightEscHandler, true);
                this._highlightEscHandler = null;
            }
            this._highlightRuleId = null;
            
            // Clean up resize handler
            if (this.resizeHandler) {
                window.removeEventListener('resize', this.resizeHandler);
                this.resizeHandler = null;
            }
            
            // Remove the shadow DOM container
            const container = document.getElementById('uw-a11y-container');
            if (container) container.remove();
            
            // Remove global styles
            const globalStyles = document.getElementById('uw-a11y-global-styles');
            if (globalStyles) globalStyles.remove();
            
            // Remove highlights from the main document
            document.querySelectorAll('.uw-a11y-highlight').forEach(el => {
                el.classList.remove('uw-a11y-highlight');
            });
            
            delete window.uwAccessibilityChecker;
        },

        // Debug method to trigger update notification
        debugShowUpdateNotification: function() {
            this.showUpdateNotification('1.5.0', 'https://github.com/Heroic-Pixel/Pinpoint-Accessibility-Checker/releases/tag/v1.5.0');
        }
    };
    
    // Initialize the accessibility checker
    window.uwAccessibilityChecker.init();
})(); 
