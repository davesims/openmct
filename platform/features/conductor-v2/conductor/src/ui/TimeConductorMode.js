/*****************************************************************************
 * Open MCT Web, Copyright (c) 2014-2015, United States Government
 * as represented by the Administrator of the National Aeronautics and Space
 * Administration. All rights reserved.
 *
 * Open MCT Web is licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 *
 * Open MCT Web includes source code licensed under additional open source
 * licenses. See the Open Source Licenses file (LICENSES.md) included with
 * this source code distribution or the Licensing information page available
 * at runtime from the About dialog for additional information.
 *****************************************************************************/

define(
    [],
    function () {

        /**
         * Supports mode-specific time conductor behavior.
         *
         * @constructor
         * @param {TimeConductorMetadata} metadata
         */
        function TimeConductorMode(metadata, conductor, timeSystems) {
            this.conductor = conductor;

            this.mdata = metadata;
            this.dlts = undefined;
            this.source = undefined;
            this.sourceUnlisten = undefined;
            this.systems = timeSystems;
            this.availableSources = undefined;
            this.changeTimeSystem = this.changeTimeSystem.bind(this);
            this.tick = this.tick.bind(this);

            //Set the time system initially
            if (conductor.timeSystem()) {
                this.changeTimeSystem(conductor.timeSystem());
            }

            //Listen for subsequent changes to time system
            conductor.on('timeSystem', this.changeTimeSystem);

            if (metadata.key === 'fixed') {
                //Fixed automatically supports all time systems
                this.availableSystems = timeSystems;
            } else {
                this.availableSystems = timeSystems.filter(function (timeSystem) {
                    //Only include time systems that have tick sources that
                    // support the current mode
                    return timeSystem.tickSources().some(function (tickSource) {
                        return metadata.key === tickSource.metadata.mode;
                    });
                });
            }
        }

        /**
         * Get or set the currently selected time system
         * @param timeSystem
         * @returns {TimeSystem} the currently selected time system
         */
        TimeConductorMode.prototype.changeTimeSystem = function (timeSystem) {
            // On time system change, apply default deltas
            var defaults = timeSystem.defaults() || {
                    bounds: {
                        start: 0,
                        end: 0
                    },
                    deltas: {
                        start: 0,
                        end: 0
                    }
                };

            this.conductor.bounds(defaults.bounds);
            this.deltas(defaults.deltas);

            // Tick sources are mode-specific, so restrict tick sources to only those supported by the current mode.
            var key = this.mdata.key;
            var tickSources = timeSystem.tickSources();
            if (tickSources) {
                this.availableSources = tickSources.filter(function (source) {
                    return source.metadata.mode === key;
                });
            }

            // Set an appropriate tick source from the new time system
            this.tickSource(this.availableTickSources(timeSystem)[0]);
        };

        /**
         * @returns {ModeMetadata}
         */
        TimeConductorMode.prototype.metadata = function () {
            return this.mdata;
        };

        TimeConductorMode.prototype.availableTimeSystems = function () {
            return this.availableSystems;
        };

        /**
         * Tick sources are mode-specific. This returns a filtered list of the tick sources available in the currently selected mode
         * @param timeSystem
         * @returns {Array.<T>}
         */
        TimeConductorMode.prototype.availableTickSources = function (timeSystem) {
            return this.availableSources;
        };

        /**
         * Get or set tick source. Setting tick source will also start
         * listening to it and unlisten from any existing tick source
         * @param tickSource
         * @returns {TickSource}
         */
        TimeConductorMode.prototype.tickSource = function (tickSource) {
            if (arguments.length > 0) {
                if (this.sourceUnlisten) {
                    this.sourceUnlisten();
                }
                this.source = tickSource;
                if (tickSource) {
                    this.sourceUnlisten = tickSource.listen(this.tick);
                    //Now following a tick source
                    this.conductor.follow(true);
                } else {
                    this.conductor.follow(false);
                }
            }
            return this.source;
        };

        TimeConductorMode.prototype.destroy = function () {
            this.conductor.off('timeSystem', this.changeTimeSystem);

            if (this.sourceUnlisten) {
                this.sourceUnlisten();
            }
        };

        /**
         * @private
         * @param {number} time some value that is valid in the current TimeSystem
         */
        TimeConductorMode.prototype.tick = function (time) {
            var deltas = this.deltas();
            var startTime = time;
            var endTime = time;

            if (deltas) {
                startTime = time - deltas.start;
                endTime = time + deltas.end;
            }
            this.conductor.bounds({
                start: startTime,
                end: endTime
            });
        };

        /**
         * Get or set the current value for the deltas used by this time system.
         * On change, the new deltas will be used to calculate and set the
         * bounds on the time conductor.
         * @param deltas
         * @returns {TimeSystemDeltas}
         */
        TimeConductorMode.prototype.deltas = function (deltas) {
            if (arguments.length !== 0) {
                var bounds = this.calculateBoundsFromDeltas(deltas);
                this.dlts = deltas;
                if (this.metadata().key !== 'fixed') {
                    this.conductor.bounds(bounds);
                }
            }
            return this.dlts;
        };

        /**
         *
         * @param deltas
         * @returns {TimeConductorBounds}
         */
        TimeConductorMode.prototype.calculateBoundsFromDeltas = function (deltas) {
            var oldEnd = this.conductor.bounds().end;

            if (this.dlts && this.dlts.end !== undefined) {
                //Calculate the previous raw end value (without delta)
                oldEnd = oldEnd - this.dlts.end;
            }

            var bounds = {
                start: oldEnd - deltas.start,
                end: oldEnd + deltas.end
            };
            return bounds;
        };

        /**
         * Calculates bounds and deltas based on a timeSpan. Collectively
         * the bounds and deltas will constitute the new zoom level.
         * @param {number} timeSpan time duration in ms.
         */
        TimeConductorMode.prototype.calculateZoom = function (timeSpan) {
            var zoom = {};

            // If a tick source is defined, then the concept of 'now' is
            // important. Calculate zoom based on 'now'.
            if (this.tickSource()) {
                zoom.deltas = {
                    start: timeSpan,
                    end: this.dlts.end
                };
                zoom.bounds = this.calculateBoundsFromDeltas(zoom.deltas);
                // Calculate bounds based on deltas;
            } else {
                var bounds = this.conductor.bounds();
                var center = bounds.start + ((bounds.end - bounds.start)) / 2;
                bounds.start = center - timeSpan / 2;
                bounds.end = center + timeSpan / 2;
                zoom.bounds = bounds;
            }

            return zoom;
        };

        return TimeConductorMode;
    }
);
