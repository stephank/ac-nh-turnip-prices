function update_chart(input_data, possibilities) {
  const font_family = "'Varela Round', sans-serif";
  const [chart_el] = $("#chart");

  // Scale the graph based on window size.
  const unit = chart_el.clientWidth / 100;
  const line_width = Math.max(1, Math.floor(unit / 4));
  const width = 100 * unit;
  const height = 50 * unit;
  const margin = {
    top: 10,
    right: 0,
    bottom: 40,
    left: 30
  };

  // X-axis domain is the turnip intervals.
  const columns = [i18next.t("weekdays.sunday")].concat(
    ...[
      i18next.t("weekdays.abr.monday"),
      i18next.t("weekdays.abr.tuesday"),
      i18next.t("weekdays.abr.wednesday"),
      i18next.t("weekdays.abr.thursday"),
      i18next.t("weekdays.abr.friday"),
      i18next.t("weekdays.abr.saturday")
    ].map(day =>
      [i18next.t("times.morning"), i18next.t("times.afternoon")].map(
        time => `${day} ${time}`
      )
    )
  );

  // Find the extent of all values, so we know the Y-axis domain.
  const [min, max] = d3.extent([
    ...input_data,
    ...possibilities[0].prices.map(price => price.min),
    ...possibilities[0].prices.map(price => price.max)
  ]);

  // Find extents for each day, so we can draw min/max lines.
  const extents = possibilities[0].prices
    .slice(1)
    .map(({ min, max }, idx) => ({ min, max, idx }))
    // Only draw extents for days with no input.
    .filter(price => price.min !== price.max);

  // The X-axis scale function, which uses discrete bands.
  const x_scale = d3
    .scaleBand()
    .domain(columns)
    .range([margin.left, width - margin.right])
    .padding(0.1)
    .round(true);

  // The Y-axis scale function. Use an exponential scale that squishes high
  // values, specifically to increase visibility of 'decreasing' in a 'large
  // spike' graph.
  const y_scale = d3
    .scalePow()
    .domain([min - 5, max])
    .range([height - margin.bottom, margin.top])
    .exponent(0.5)
    .interpolate(d3.interpolateRound);

  // This actually maps pattern number to sort order. These are sorted roughly
  // by the area bars are expected to take up, so patterns with large possible
  // price ranges are sorted to the back.
  const pattern_sort = [1, 3, 0, 2];

  // From: https://colorbrewer2.org/#type=diverging&scheme=PRGn&n=4
  const pattern_colors = ["#f1b6da", "#4dac26", "#d01c8b", "#b8e186"];
  const pattern_colors_fg = ["#000", "#fff", "#fff", "#000"];

  // Filter empty values from input, but preserve indices.
  const filtered_input = input_data
    .slice(1)
    .map((value, idx) => ({ value, idx }))
    .filter(price => price.value);

  // Group possibilities by pattern, and sort them in draw order.
  const max_probability = d3.max(
    possibilities.slice(1).map(pos => pos.category_total_probability)
  );
  const patterns = d3
    .nest()
    .key(pos => pos.pattern_number)
    .entries(possibilities.slice(1))
    .map(({ key, values }) => {
      const {
        pattern_number: number,
        pattern_description: description,
        category_total_probability: probability
      } = values[0];

      // Create a flat list of prices.
      const merged = [];
      for (const pos of values) {
        for (const [idx, price] of pos.prices.slice(1).entries()) {
          // Filter zero-height bars.
          if (price.min === price.max) {
            continue;
          }

          // Merge ranges that overlap.
          const existing = merged.find(
            other =>
              other.idx === idx &&
              other.min <= price.max &&
              other.max >= price.min
          );
          if (existing) {
            existing.min = Math.min(existing.min, price.min);
            existing.max = Math.max(existing.max, price.max);
          } else {
            merged.push({ idx, min: price.min, max: price.max });
          }
        }
      }

      // Probability scaling factor. Relative to max probability, in 5 steps.
      const factor = Math.ceil((probability / max_probability) * 5) / 5;
      // Add padding / narrow bars as probability decreases.
      const x_pad = (1 - factor) * (x_scale.bandwidth() * (1 / 2));

      return {
        description,
        probability,
        order: pattern_sort.indexOf(number),
        color: pattern_colors[number],
        color_fg: pattern_colors_fg[number],
        x_pad,
        prices: merged
      };
    });

  // Initialize the chart.
  const legend = d3.select("#chart-legend");
  const chart = d3
    .select(chart_el)
    .attr("viewBox", [0, 0, width, height])
    .attr("shape-rendering", "crispEdges");
  legend.selectAll("div").remove();
  chart.selectAll("g").remove();

  // Draw the legend.
  legend
    .selectAll("div")
    .data(patterns.sort((a, b) => a.probability < b.probability))
    .join("div")
    .each(function(pattern) {
      const item = d3.select(this).attr("class", "chart-legend-item");
      item
        .append("span")
        .attr("class", "chart-legend-sample")
        .text(displayPercentage(pattern.probability))
        .style("background-color", pattern.color)
        .style("color", pattern.color_fg);
      item
        .append("span")
        .attr("class", "chart-legend-descr")
        .text(pattern.description);
    });

  // Draw axes.
  chart
    .append("g")
    .style("font-family", font_family)
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(d3.axisBottom(x_scale).tickSize(0))
    .selectAll("text")
    .style("text-anchor", "end")
    .attr("dx", "-0.5em")
    .attr("dy", "1em")
    .attr("transform", "rotate(-45)");
  chart
    .append("g")
    .style("font-family", font_family)
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(
      d3
        .axisLeft(y_scale)
        .ticks(5)
        .tickSize(0)
    )
    .selectAll(".tick line")
    .clone()
    .attr("stroke-opacity", 0.2)
    .attr("x2", width - margin.left - margin.right);

  // Draw bars.
  chart
    .append("g")
    .selectAll("g")
    .data(patterns.sort((a, b) => a.order > b.order))
    .join("g")
    .each(function({ color, x_pad, prices }) {
      d3.select(this)
        .attr("fill", color)
        .attr("stroke", "#0004")
        .attr("stroke-width", 2)
        .selectAll("rect")
        .data(prices)
        .join("rect")
        .attr("clip-path", "fill-box")
        .attr("x", price => x_pad + x_scale(columns[price.idx]))
        .attr("y", price => y_scale(price.max))
        .attr("width", x_scale.bandwidth() - x_pad * 2)
        .attr("height", price => y_scale(price.min) - y_scale(price.max));
    });

  // Draw day extents.
  chart
    .append("g")
    .attr("stroke", "#000")
    .attr("stroke-width", line_width)
    .selectAll("line")
    .data(extents)
    .join("line")
    .attr("x1", price => x_scale(columns[price.idx]))
    .attr("x2", price => x_scale(columns[price.idx]) + x_scale.bandwidth())
    .attr("y1", price => y_scale(price.min))
    .attr("y2", price => y_scale(price.min));
  chart
    .append("g")
    .attr("stroke", "#000")
    .attr("stroke-width", line_width)
    .selectAll("line")
    .data(extents)
    .join("line")
    .attr("x1", price => x_scale(columns[price.idx]))
    .attr("x2", price => x_scale(columns[price.idx]) + x_scale.bandwidth())
    .attr("y1", price => y_scale(price.max))
    .attr("y2", price => y_scale(price.max));

  // Draw input.
  chart
    .append("g")
    .attr("stroke", "#000")
    .attr("stroke-width", line_width)
    .selectAll("line")
    .data(filtered_input)
    .join("line")
    .attr("x1", price => x_scale(columns[price.idx]))
    .attr("x2", price => x_scale(columns[price.idx]) + x_scale.bandwidth())
    .attr("y1", price => y_scale(price.value))
    .attr("y2", price => y_scale(price.value));
}
