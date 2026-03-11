const margin = { top: 80, right: 80, bottom: 80, left: 80 };
let width = document.getElementById('tree-container').clientWidth;
let height = document.getElementById('tree-container').clientHeight;

const svg = d3.select("#tree-container").append("svg")
    .attr("width", width)
    .attr("height", height)
    .call(d3.zoom().on("zoom", function (event) {
        svgGroup.attr("transform", event.transform);
    }))
    .on("click", function (event) {
        // Cập nhật: Nhận diện thêm lớp overlay của Brush để khi click ra nền đen sẽ hủy chọn chính xác
        const isBackground = event.target.tagName === 'svg' ||
            event.target.tagName === 'g' ||
            event.target.classList.contains('overlay') ||
            event.target.classList.contains('selection');

        if (isBackground) {
            if (typeof selectedNodes !== 'undefined' && selectedNodes.size > 0) {
                selectedNodes.clear();
                d3.selectAll('.node-card').classed('selected', false); // Xóa viền đỏ tức thì
                update(root);
            }
        }
    })
    .append("g");

// Chỉnh lại toạ độ trọng tâm: nằm ở phía trên (margin.top), ở giữa màn hình
const svgGroup = svg.append("g").attr("transform", `translate(${width / 2},${margin.top})`);

let root = d3.hierarchy(treeData, d => d.children);

// --- LOCAL STORAGE STATE ---
function assignPathIds(node, path) {
    node.pathId = path;
    if (node.children) {
        node.children.forEach((c, idx) => assignPathIds(c, path + "-" + idx));
    }
}
assignPathIds(treeData, "0");

root.each(d => d.id = d.data.pathId); // Gắn pathId ổn định cho mỗi node làm ID thật cho D3
root.x0 = 0;
root.y0 = 0;

let i = 0; // Legacy
const duration = 750;

// Sử dụng nodeSize với: X (ngang) cách nhau 140px, Y (dọc) sâu xuống 600px theo từng tầng
const treeMap = d3.tree().nodeSize([180, 600]);

// Hàm rút gọn các nhánh (nếu muốn)
function collapse(d) {
    if (d.children) {
        d._children = d.children;
        d._children.forEach(collapse);
        d.children = null;
    }
}

let customLinks = [];
let deletedLinks = []; // Lưu các link mặc định đã bị xoá bởi người dùng
let selectedNodes = new Set(); // Multi-select Set

// --- CHỨC NĂNG QUÉT CHỌN NHIỀU BẢNG (BRUSH) ---
// Dùng API chuẩn của D3, không ẩn hiện bằng CSS để tránh lỗi kẹt trạng thái
const brush = d3.brush()
    .filter(event => {
        // CHỈ KÍCH HOẠT QUÉT VÙNG KHI: Giữ phím Ctrl (hoặc Alt tùy bạn đang thiết lập) và bấm Chuột trái
        return event.ctrlKey && !event.button;
    })
    // Tăng giới hạn không gian lên 1 triệu pixel (thoải mái quét ở bất kỳ tọa độ nào)
    .extent([[-1000000, -1000000], [1000000, 1000000]])
    .on("start", brushStarted)
    .on("brush", brushed)
    .on("end", brushEnded);

const brushGroup = svgGroup.append("g")
    .attr("class", "brush")
    .call(brush);

function brushStarted(event) {
    if (!event.selection) return;
    // Bỏ chọn tất cả trước khi quét vùng mới
    selectedNodes.clear();
    d3.selectAll('.node-card').classed('selected', false);
}

function brushed(event) {
    if (!event.selection) return;
    const [[x0, y0], [x1, y1]] = event.selection;

    d3.selectAll("g.node").each(function (d) {
        // Trục X đang đảo dấu trong hàm update
        let nodeX = -(d.x + (d.data.offsetX || 0));
        let nodeY = d.y + (d.data.offsetY || 0);

        // Nới rộng khoảng bắt dính
        let isInside = nodeX >= x0 - 80 && nodeX <= x1 + 80 && nodeY >= y0 - 50 && nodeY <= y1 + 150;

        if (isInside) {
            selectedNodes.add(d.id);
            d3.select(this).select('.node-card').classed("selected", true);
        } else {
            selectedNodes.delete(d.id);
            d3.select(this).select('.node-card').classed("selected", false);
        }
    });
}

function brushEnded(event) {
    if (event.selection) {
        brushGroup.call(brush.move, null); // Tự động xóa khung nét đứt khi thả chuột
        update(root);
    }
}
// --- KẾT THÚC CHỨC NĂNG BRUSH ---

// Đọc dữ liệu đã lưu từ LocalStorage
let savedState = null;
try {
    const ls = localStorage.getItem("treeMapState_" + document.title);
    if (ls) {
        savedState = JSON.parse(ls);
    } else if (typeof defaultLayout !== 'undefined' && defaultLayout) {
        savedState = defaultLayout;
    }
} catch (e) { }

if (savedState) {
    root.each(d => {
        if (savedState.offsets && savedState.offsets[d.data.pathId]) {
            d.data.offsetX = savedState.offsets[d.data.pathId].x;
            d.data.offsetY = savedState.offsets[d.data.pathId].y;
        }
        if (savedState.collapsed && savedState.collapsed.includes(d.data.pathId)) {
            if (d.children) {
                d._children = d.children;
                d.children = null;
            }
        }
    });

    if (savedState.deletedLinks) deletedLinks = savedState.deletedLinks;
}

const nodeMap = {};
root.each(d => nodeMap[d.data.pathId] = d);

if (savedState && savedState.customLinks) {
    savedState.customLinks.forEach(link => {
        const s = nodeMap[link.sourceId];
        const t = nodeMap[link.targetId];
        if (s && t) customLinks.push({ source: s, target: t });
    });
}

function saveTreeState() {
    const state = {
        offsets: {},
        customLinks: customLinks.map(l => ({ sourceId: l.source.data.pathId, targetId: l.target.data.pathId })),
        deletedLinks: deletedLinks,
        collapsed: []
    };
    root.each(d => {
        if (d.data.offsetX || d.data.offsetY) {
            state.offsets[d.data.pathId] = { x: d.data.offsetX, y: d.data.offsetY };
        }
        if (d._children && !d.children) {
            state.collapsed.push(d.data.pathId);
        }
    });
    localStorage.setItem("treeMapState_" + document.title, JSON.stringify(state));
}

update(root);

function update(source) {
    const treeData = treeMap(root);
    const nodes = treeData.descendants();
    let links = treeData.descendants().slice(1);

    // Lọc bỏ những link đã bị người dùng xoá
    links = links.filter(l => !deletedLinks.some(dl => dl.source === l.parent.id && dl.target === l.id));

    nodes.forEach(d => {
        d.y = d.depth * 600;
        if (!d.data.offsetX) d.data.offsetX = 0;
        if (!d.data.offsetY) d.data.offsetY = 0;
    });

    // Vẽ Trục Ngang Vô Tận (Grid Axes)
    let maxDepth = d3.max(nodes, d => d.depth) || 0;
    let axesData = [];
    // Vẽ thêm 10 đường phía trên và 5 đường phía dưới để hỗ trợ kéo thả tự do
    for (let i = -10; i <= maxDepth + 5; i++) {
        axesData.push({ depth: i, y: i * 600 });
    }

    // Tự động quét và tìm điểm xa nhất bên trái/phải của toàn bộ các bảng chữ hiện có
    let minLeft = d3.min(nodes, d => -(d.x + (d.data.offsetX || 0))) - 2000;
    let maxRight = d3.max(nodes, d => -(d.x + (d.data.offsetX || 0))) + 2000;

    // Đảm bảo đường luôn dài tối thiểu 50.000px để không bị cụt khi sơ đồ còn nhỏ
    if (minLeft > -50000) minLeft = -50000;
    if (maxRight < 50000) maxRight = 50000;

    const axes = svgGroup.selectAll('line.grid-axis').data(axesData, d => d.depth);
    axes.enter().insert('line', ':first-child')
        .attr('class', 'grid-axis')
        .style('stroke', '#00ff00') // Màu xanh lá cây giống AutoCAD
        .style('stroke-dasharray', '8,4')
        .style('opacity', 0.6)
        .style('stroke-width', 1.5)
        .style('pointer-events', 'none')
        .merge(axes)
        .transition().duration(duration)
        .attr('x1', minLeft)  // Điểm bắt đầu tự động bám theo lề trái
        .attr('x2', maxRight) // Điểm kết thúc tự động bám theo lề phải
        .attr('y1', d => d.y)
        .attr('y2', d => d.y);
    axes.exit().remove();

    const node = svgGroup.selectAll('g.node')
        .data(nodes, d => d.id || (d.id = ++i));

    const nodeEnter = node.enter().append('g')
        .attr('class', 'node')
        .attr("transform", d => `translate(${-(source.x0 + source.data.offsetX)},${source.y0 + source.data.offsetY})`);

    // Gắn sự kiện kéo thả (Drag) vào cả cụm node
    const dragNode = d3.drag()
        .on("start", function (event, d) {
            d3.select(this).raise();
        })
        .on("drag", function (event, d) {
            const dx = event.dx;
            const dy = event.dy;
            const isMultiDrag = typeof selectedNodes !== 'undefined' && selectedNodes.has(d.id);

            if (isMultiDrag) {
                nodes.forEach(n => {
                    if (selectedNodes.has(n.id)) {
                        n.data.offsetX -= dx;
                        n.data.offsetY += dy;
                    }
                });
            } else {
                d.data.offsetX -= dx;
                d.data.offsetY += dy;
            }

            svgGroup.selectAll('g.node')
                .filter(n => isMultiDrag ? selectedNodes.has(n.id) : n.id === d.id)
                .attr("transform", n => `translate(${-(n.x + n.data.offsetX)},${n.y + n.data.offsetY})`);

            svgGroup.selectAll('path.link')
                .attr('d', l => diagonal(l, l.parent));

            svgGroup.selectAll('path.custom-link')
                .attr('d', l => customDiagonal(l.source, l.target));
        })
        .on("end", function (event, d) {
            saveTreeState();
        });

    nodeEnter.call(dragNode);

    nodeEnter.append('circle')
        .attr('class', 'main-circle')
        .attr('r', 1e-6)
        .style("fill", d => d._children ? "#e0c38c" : "#1b1b22")
        .style("stroke", "#e0c38c")
        .style("stroke-width", "2.5px")
        .style("display", d => d.data.isEmptyNode ? "none" : null)
        .on('click', click);

    nodeEnter.append('rect')
        .attr('class', 'bg-rect')
        .attr('width', 130)
        .attr('height', d => {
            const numWords = d.data.words ? d.data.words.length : 1;
            const hasHeader = d.data.header ? 1 : 0;
            return 75 + numWords * 50 + hasHeader * 30;
        })
        .attr('x', -65)
        .attr('y', 15)
        .style('fill', 'rgba(0,0,0,0)')
        .style('cursor', 'pointer')
        .style("display", d => d.data.isEmptyNode ? "none" : null)
        .on('click', click);

    nodeEnter.append('foreignObject')
        .attr('width', 130)
        .attr('height', d => {
            const numWords = d.data.words ? d.data.words.length : 1;
            const hasHeader = d.data.header ? 1 : 0;
            return 75 + numWords * 50 + hasHeader * 30;
        })
        .attr('x', -65)
        .attr('y', 15)
        .style('pointer-events', 'none')
        .html(d => {
            const isSelected = typeof selectedNodes !== 'undefined' && selectedNodes.has(d.id);
            const cardClass = isSelected ? "node-card selected" : "node-card";

            if (d.data.isEmptyNode) {
                return '';
            }

            if (!d.data.words) {
                return `<div class="${cardClass}"><span style="color:white;text-align:center">${d.data.name}</span></div>`;
            }
            let htmlStr = `<div class="${cardClass}">`;

            if (d.data.header) {
                htmlStr += `<div class="node-header">${d.data.header}</div>`;
            }

            d.data.words.forEach(w => {
                const py = w.pinyin && w.pinyin.trim() ? w.pinyin : '';
                const hv = w.hv && w.hv.trim() ? w.hv : '';
                htmlStr += `
                 <div class="char-row">
                     <div class="cn-char">${w.char}</div>
                     <div class="phonetics">
                         <div class="pinyin">${py}</div>
                         <div class="hanviet">${hv}</div>
                     </div>
                 </div>`;
            });
            let meaningHtml = '';
            if (d.data.meaning && d.data.meaning.trim() !== "") {
                meaningHtml = `<div class="separator"></div><div class="meaning">${d.data.meaning}</div>`;
            }
            htmlStr += `${meaningHtml}</div>`;
            return htmlStr;
        });

    // --- LOGIC Kéo nối dây ---
    let dragLine;
    const dragPort = d3.drag()
        .on("start", function (event, d) {
            event.sourceEvent.stopPropagation();
            d3.select(this).classed("active", true);
            const numWords = d.data.words ? d.data.words.length : 1;
            const hasHeader = d.data.header ? 1 : 0;
            const portCy = 75 + numWords * 50 + hasHeader * 30 + 15;
            const startX = -(d.x + d.data.offsetX);
            const startY = d.y + d.data.offsetY + portCy;

            dragLine = svgGroup.append("path")
                .attr("class", "drag-line")
                .style("stroke", "red")
                .style("stroke-width", "3px")
                .style("fill", "none")
                .attr("d", `M ${startX} ${startY} L ${startX} ${startY}`);
        })
        .on("drag", function (event, d) {
            const numWords = d.data.words ? d.data.words.length : 1;
            const hasHeader = d.data.header ? 1 : 0;
            const portCy = 75 + numWords * 50 + hasHeader * 30 + 15;
            const startX = -(d.x + d.data.offsetX);
            const startY = d.y + d.data.offsetY + portCy;
            const mouseCoord = d3.pointer(event, svgGroup.node());

            dragLine.attr("d", `M ${startX} ${startY} C ${startX} ${(startY + mouseCoord[1]) / 2}, ${mouseCoord[0]} ${(startY + mouseCoord[1]) / 2}, ${mouseCoord[0]} ${mouseCoord[1]}`);
        })
        .on("end", function (event, d) {
            d3.select(this).classed("active", false);
            dragLine.remove();

            const mouseCoord = d3.pointer(event, svgGroup.node());
            let targetNode = null;

            nodes.forEach(n => {
                if (n === d) return;
                const tx = -(n.x + n.data.offsetX);
                const ty = n.y + n.data.offsetY - 20;
                const dist = Math.sqrt(Math.pow(tx - mouseCoord[0], 2) + Math.pow(ty - mouseCoord[1], 2));
                if (dist < 40) {
                    targetNode = n;
                }
            });

            if (targetNode) {
                customLinks.push({ source: d, target: targetNode });
                renderCustomLinks();
                saveTreeState();
            }
        });

    nodeEnter.append('circle')
        .attr('class', 'source-port')
        .attr('r', 8)
        .attr('cx', 0)
        .attr('cy', d => {
            const numWords = d.data.words ? d.data.words.length : 1;
            const hasHeader = d.data.header ? 1 : 0;
            return 75 + numWords * 50 + hasHeader * 30 + 15;
        })
        .style("fill", "red")
        .style("stroke", "#fff")
        .style("stroke-width", "2px")
        .style("cursor", "crosshair")
        .style("display", d => d.data.isEmptyNode ? "none" : null)
        .call(dragPort);

    nodeEnter.append('circle')
        .attr('class', 'target-port')
        .attr('r', 8)
        .attr('cx', 0)
        .attr('cy', -15)
        .style("fill", "#00ff00")
        .style("stroke", "#fff")
        .style("stroke-width", "2px")
        .style("display", d => d.data.isEmptyNode ? "none" : null);

    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate.transition()
        .duration(duration)
        .attr("transform", d => `translate(${-(d.x + d.data.offsetX)},${d.y + d.data.offsetY})`);

    nodeUpdate.select('circle.main-circle')
        .attr('r', 8)
        .style("fill", d => d._children ? "#e0c38c" : "#1b1b22")
        .attr('cursor', 'pointer');

    nodeUpdate.select('.node-card')
        .attr('class', d => {
            const isSelected = typeof selectedNodes !== 'undefined' && selectedNodes.has(d.id);
            return isSelected ? "node-card selected" : "node-card";
        });

    const nodeExit = node.exit().transition()
        .duration(duration)
        .attr("transform", d => `translate(${-(source.x + source.data.offsetX)},${source.y + source.data.offsetY})`)
        .remove();

    nodeExit.select('circle').attr('r', 1e-6);

    const link = svgGroup.selectAll('path.link')
        .data(links, d => d.id);

    const linkEnter = link.enter().insert('path', "g")
        .attr("class", "link")
        .style("stroke", "#444")
        .style("stroke-width", "3px")
        .style("fill", "none")
        .style("cursor", "pointer")
        .style("pointer-events", "visibleStroke")
        .attr('d', d => {
            const o = { x: source.x0, y: source.y0, data: { offsetX: 0, offsetY: 0, words: source.data.words, header: source.data.header } };
            return diagonal(o, o);
        })
        .on("mouseover", function () { d3.select(this).style("stroke", "orange").style("stroke-width", "6px"); })
        .on("mouseout", function () { d3.select(this).style("stroke", "#444").style("stroke-width", "3px"); })
        .on("click", function (event, d) {
            if (confirm("Xoá dây nối mặc định này?")) {
                deletedLinks.push({ source: d.parent.id, target: d.id });
                update(root);
                saveTreeState();
            }
        });

    const linkUpdate = linkEnter.merge(link);
    linkUpdate.transition()
        .duration(duration)
        .attr('d', d => diagonal(d, d.parent));

    link.exit().transition()
        .duration(duration)
        .attr('d', d => {
            const o = { x: source.x, y: source.y, data: { offsetX: 0, offsetY: 0, words: source.data.words, header: source.data.header } };
            return diagonal(o, o);
        })
        .remove();

    renderCustomLinks();

    nodes.forEach(d => {
        d.x0 = d.x;
        d.y0 = d.y;
    });

    function diagonal(s, d) {
        const numWordsS = s.data.words ? s.data.words.length : 1;
        const hasHeaderS = s.data.header ? 1 : 0;
        const portOffS = 75 + numWordsS * 50 + hasHeaderS * 30 + 15;

        const sX = -(s.x + (s.data.offsetX || 0));
        const sY = s.y + (s.data.offsetY || 0) + portOffS;

        const dX = -(d.x + (d.data.offsetX || 0));
        const dY = d.y + (d.data.offsetY || 0) - 15;

        return `M ${sX} ${sY}
                C ${sX} ${(sY + dY) / 2},
                  ${dX} ${(sY + dY) / 2},
                  ${dX} ${dY}`;
    }

    function customDiagonal(s, d) {
        const numWordsS = s.data.words ? s.data.words.length : 1;
        const hasHeaderS = s.data.header ? 1 : 0;
        const portOffS = 75 + numWordsS * 50 + hasHeaderS * 30 + 15;
        const sX = -(s.x + (s.data.offsetX || 0));
        const sY = s.y + (s.data.offsetY || 0) + portOffS;

        const dX = -(d.x + (d.data.offsetX || 0));
        const dY = d.y + (d.data.offsetY || 0) - 15;

        return `M ${sX} ${sY}
                C ${sX} ${(sY + dY) / 2},
                  ${dX} ${(sY + dY) / 2},
                  ${dX} ${dY}`;
    }

    function renderCustomLinks() {
        const cLinks = svgGroup.selectAll('path.custom-link')
            .data(customLinks);

        cLinks.enter().insert('path', "g")
            .attr("class", "custom-link")
            .style("stroke", "red")
            .style("stroke-width", "3px")
            .style("fill", "none")
            .style("cursor", "pointer")
            .style("pointer-events", "visibleStroke")
            .on("mouseover", function () { d3.select(this).style("stroke", "orange").style("stroke-width", "6px"); })
            .on("mouseout", function () { d3.select(this).style("stroke", "red").style("stroke-width", "3px"); })
            .on("click", function (event, d) {
                if (confirm("Xoá dây tự nối màu đỏ này?")) {
                    customLinks = customLinks.filter(l => l !== d);
                    renderCustomLinks();
                    saveTreeState();
                }
            })
            .merge(cLinks)
            .attr("d", l => customDiagonal(l.source, l.target));

        cLinks.exit().remove();
    }

    function click(event, d) {
        // Vẫn giữ nguyên tính năng Multi-select (Chọn nhiều bảng) khi giữ Shift hoặc Ctrl
        if (event.shiftKey || event.ctrlKey || event.metaKey) {
            if (selectedNodes.has(d.id)) {
                selectedNodes.delete(d.id);
            } else {
                selectedNodes.add(d.id);
            }
            update(root);
            return;
        }

        // --- TÍNH NĂNG COLLAPSE (GẬP NHÁNH) ĐÃ BỊ KHÓA ---
        /* (Đoạn code cũ dưới đây đã được vô hiệu hóa)
        if (d.children) {
            d._children = d.children;
            d.children = null;
        } else {
            d.children = d._children;
            d._children = null;
        }
        update(d);
        saveTreeState(); 
        */

        // MỚI: Nếu click chuột trái bình thường (không giữ phím), ta sẽ chọn duy nhất bảng này và bỏ chọn các bảng khác
        selectedNodes.clear();
        selectedNodes.add(d.id);
        update(root);
    }
}

// --- TOOLBAR FUNCTIONS ---
window.exportLayout = function () {
    const stateStr = localStorage.getItem("treeMapState_" + document.title);
    if (!stateStr) {
        alert("Chưa có thay đổi nào được lưu tạm trong trình duyệt để xuất.");
        return;
    }
    const dataStr = "const defaultLayout = " + stateStr + ";";
    const blob = new Blob([dataStr], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'layout_data.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

window.resetLayout = function () {
    if (confirm("Bạn có chắc chắn muốn xoá toàn bộ Layout Tuỳ Chỉnh trên máy mình và khôi phục về trạng thái ban đầu?")) {
        localStorage.removeItem("treeMapState_" + document.title);
        location.reload();
    }
};

window.autoLayout = function () {
    if (confirm("Lệnh này sẽ biến toàn bộ sơ đồ thành một bảng lưới đồng đều, lấy chiều dài của bảng chữ bự nhất làm thước đo chuẩn để xây dựng khoảng cách ô cho các tầng. Toàn bộ toạ độ kéo tay lập tức bị xoá. Bạn có chắc chắn?")) {
        let maxHeight = 0;
        root.each(d => {
            const numWords = d.data.words ? d.data.words.length : 1;
            const hasHeader = d.data.header ? 1 : 0;
            const height = 75 + numWords * 50 + hasHeader * 30 + 15;
            if (height > maxHeight) maxHeight = height;
        });

        const verticalGridStep = maxHeight + 100;

        root.each(d => {
            d.targetY = d.depth * verticalGridStep;
            d.data.offsetY = d.targetY - (d.depth * 600);
            d.data.offsetX = 0;
        });

        update(root);
        saveTreeState();
    }
};