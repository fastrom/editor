define([
    "hr/hr",
    "hr/promise",
    "utils/normalize",
    "utils/dialogs",
    "models/article",
    "models/book",
    "core/server",
    "core/settings",
    "views/grid",
    "views/summary",
    "views/editor",
    "views/preview"
], function(hr, Q, normalize, dialogs, Article, Book, server, settings, Grid, Summary, Editor, Preview) {
    var generate = node.require("gitbook").generate,
        normalizeFilename = node.require("normall").filename,
        dirname = node.require("path").dirname;

    var BookView = hr.View.extend({
        className: "book",
        defaults: {
            base: null
        },

        initialize: function() {
            BookView.__super__.initialize.apply(this, arguments);

            this.model = this.model || new Book({}, {
                base: this.options.base
            });
            this.editorSettings = settings;

            // Map article path -> content
            this.articles = {};
            this.currentArticle = null;

            this.grid = new Grid({
                columns: 3
            }, this);
            this.grid.appendTo(this);

            // Summary
            this.summary = new Summary({}, this);
            this.summary.update();
            this.grid.addView(this.summary, {width: 20});

            // Editor
            this.editor = new Editor({}, this);
            this.editor.update();
            this.grid.addView(this.editor);

            // Preview
            this.preview = new Preview({}, this);
            this.preview.update();
            this.grid.addView(this.preview);

            this.openReadme();
        },

        // Build the book (website)
        buildBook: function(params, options) {
            var that = this;

            return generate.folder(_.extend(params || {}, {
                input: this.model.root()
            }));
        },

        // Generate a file (pdf or ebook)
        buildBookFile: function(format, params) {
            var that = this;

            var filename = format == "pdf" ? "book.pdf" : "book.epub";

            dialogs.saveAs(filename)
            .then(function(_path) {
                return generate.file(_.extend(params || {}, {
                    extension: "pdf",
                    input: that.model.root(),
                    output: _path,
                    generator: format
                }))
                .then(_.constant(_path));
            })
            .then(function(_path) {
                node.gui.Shell.showItemInFolder(_path);
            }, dialogs.error);
        },

        // Refresh preview
        refreshPreviewServer: function() {
            var that = this;
            console.log("start server on ", this.model.root());

            return server.stop()
            .then(function() {
                return that.buildBook();
            })
            .then(function(options) {
                return server.start(options.output)
            })
            .then(function() {
                server.open();
            }, function(err) {
                dialogs.alert("Error starting preview server:", err.message || err);
            });
        },

        // Open a specific article
        openArticle: function(article) {
            var that = this;

            var path = article.get("path");

            var normalize = function(path){
                path = path.replace(".md","").split("/");
                for (var i = 0; i < path.length; i++) {
                    path[i] = normalizeFilename(path[i]);
                };
                if (path[path.length -1] === "readme"){
                    path[path.length -1] = "README";
                }
                path = path.join("/") + ".md";
                return path;
            }

            var doOpen = function() {
                that.currentArticle = article;
                that.trigger("article:open", article);
                that.triggerArticleState(article);

                that.toggleArticlesClass(article, "active");

                return Q();
            };

            var doSaveAndOpen = function() {
                return Q()
                .then(function(){
                    if (path && that.editorSettings.get("autoFileManagement")){
                        article.set("path", normalize(path));
                        return Q();
                    }else{
                        return dialogs.saveAs(article.get("title")+".md", that.model.root())
                        .then(function(path) {
                            if (!that.model.isValidPath(path)) return Q.reject(new Error("Invalid path for saving this article, need to be on the book repository."));
                            path = that.model.virtualPath(path);
                            article.set("path", normalize(path));
                            return Q();
                        });
                    }

                })
                // Check if it's going to overwrite anything
                .then(function overwriteDetection(){
                    return that.model.exists(article.get("path"))
                    .then(function(exists){
                        if (exists){
                            return dialogs.saveAs("File name should be unique.", that.model.root())
                            .then(function(path) {
                                if (!that.model.isValidPath(path)) return Q.reject(new Error("Invalid path for saving this article, need to be on the book repository."));
                                path = that.model.virtualPath(path);
                                article.set("path",normalize(path));
                                return overwriteDetection();
                            });
                        }else{
                            return Q();
                        }
                    })
                })
                // Write article
                .then(function() {
                    return that.writeArticle(article, "# "+article.get("title")+"\n")
                })
                // Save the article
                .then(function() {
                    return that.saveArticle(article);
                })
                // Save summary
                .then(function() {
                    return that.summary.save();
                })
                .then(function() {
                    return doOpen();
                })
                .fail(function(err) {
                    dialogs.alert("Error", err.message || err);
                });
            };

            if (!path) {
                return doSaveAndOpen();
            } else {
                return that.model.exists(path)
                .then(function(exists) {
                    if (exists) {
                        return doOpen();
                    } else {
                        return doSaveAndOpen();
                    }
                });
            }
        },

        // Open readme
        openReadme: function() {
            return this.openArticle(new Article({}, {
                title: "Introduction",
                path: "README.md"
            }));
        },

        // Get unsaved article
        getUnsavedArticles: function() {
            return _.chain(this.articles)
            .map(function(article, _path) {
                article.path = _path;
                return article;
            })
            .filter(function(article) {
                return !article.saved;
            })
            .value();
        },

        // Save all unsaved
        saveAll: function() {
            _.each(this.getUnsavedArticles(), function(_article) {
                var article = this.summary.getArticle(_article.path);
                console.log(_article.path, article);
                if (article) this.saveArticle(article);
            }, this);
        },

        // Open edit book.json dialog
        editConfig: function() {
            var that = this, content = "{}";

            var normalizeContent = function(_content) {
                return JSON.stringify(JSON.parse(_content), null, 4);
            };

            var showDialog = function() {
                return dialogs.fields("Edit Book Configuration (book.json)", {
                    content: {
                        type: "textarea",
                        rows: 8
                    }
                }, {
                    content: content
                }, {keyboardEnter: false})
                .then(function(values) {
                    content = values.content;
                    content = normalizeContent(content);
                })
                .fail(function(err) {
                    return dialogs.confirm("Would you like to correct the error?", "Your book.json is not a valid json file: "+err.message)
                    .then(showDialog);
                });
            };

            return this.model.read("book.json")
            .fail(function() {
                return "{}";
            })
            .then(function(_content) {
                content = _content;
                content = normalizeContent(content);
            })
            .then(showDialog, showDialog)
            .then(function() {
                return that.model.write("book.json", content).fail(dialogs.error);
            });
        },

        // Read/Write article in this fs
        readArticle: function(article) {
            var that = this;
            var path = article.get("path");

            if (this.articles[path]) return Q(this.articles[path].content);

            return this.model.read(path)
            .then(function(content) {
                that.articles[path] = {
                    content: content,
                    saved: true
                };
                return content;
            });
        },

        // Update article buffer
        writeArticle: function(article, content) {
            var path = article.get("path");

            this.articles[path] = this.articles[path] || {};
            this.articles[path].saved = false;
            this.articles[path].content = content;

            this.trigger("article:write", article);
            this.triggerArticleState(article);

            return Q();
        },

        // Save an article
        saveArticle: function(article) {
            var that = this;
            var path = article.get("path");
            if (!this.articles[path]) return Q.reject(new Error("No content to save for this article"));

            // Normalize content before saving
            var content = normalize.eof(
            normalize.whitespace(
                this.articles[path].content
            ));

            // Try to create the directory
            return that.model.mkdir(dirname(path))
            .then( function(){
                return that.model.write(path, content)
            })
            .then(function() {
                that.articles[path].saved = true;
                that.triggerArticleState(article);

                // Update code views
                that.trigger("article:save", article, content);

                if (server.isRunning()) {
                    dialogs.confirm("Restart Preview Server", "Do you want to restart the preview server to access your last changes?")
                    .then(function() {
                        that.refreshPreviewServer();
                    });
                }
            });
        },

        // Update article state
        triggerArticleState: function(article) {
            var path = article.get("path");
            var st = this.articles[path]? this.articles[path].saved : true;

            this.trigger("article:state", article, st);
            this.toggleArticleClass(article, "modified", !st);
        },

        // return article state
        getArticleState: function(article) {
            article = article || this.currentArticle;
            var path = article.get("path");
            return this.articles[path];
        },
        toggleArticleClass: function(article, className, st) {
            this.$("*[data-article='"+article.get("path")+"']").toggleClass(className, st);
        },
        toggleArticlesClass: function(article, className) {
            this.$("*[data-article]").each(function() {
                $(this).toggleClass(className, $(this).data("article") == article.get("path"));
            });
        }
    });

    return BookView;
});
