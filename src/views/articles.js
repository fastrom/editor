define([
    "hr/hr",
    "utils/dragdrop",
    "utils/dialogs",
    "collections/articles",
    "text!resources/templates/article.html",
    "utils/dblclick"
], function(hr, dnd, dialogs, Articles, templateFile) {
    var normalizePath = node.require("normall").filename,
        dirname = node.require("path").dirname,
        ArticleItem = hr.List.Item.extend({
        className: "article",
        template: templateFile,
        events: {
            "click > .chapter-actions .action-add": "addChapter",
            "click > .chapter-actions .action-rename": "changeTitle",
            "click > .chapter-actions .action-remove": "removeChapter"
        },

        initialize: function() {
            var that = this;
            ArticleItem.__super__.initialize.apply(this, arguments);

            this.articles = new ArticlesView({collection: this.model.articles}, this.list.parent);
            this.summary = this.list.parent;
            this.editor = this.summary.parent;

            // Drop tabs to order
            this.dropArea = new dnd.DropArea({
                view: this,
                dragType: this.summary.drag,
                handler: function(article) {
                    var i = that.collection.indexOf(that.model);
                    var ib = that.collection.indexOf(article);

                    if (ib >= 0 && ib < i) {
                        i = i - 1;
                    }
                    article.collection.remove(article);
                    that.collection.add(article, {
                        at: i
                    });
                    that.summary.save();
                }
            });

            this.summary.drag.enableDrag({
                view: this,
                data: this.model,
                start: function() {
                    return !that.$el.hasClass("mode-edit");
                }
            });

        },

        render: function() {
            this.articles.collection.reset(this.model.get("articles", []));
            if (this.model.get("path")) this.$el.attr("data-article", this.model.get("path"));
            return ArticleItem.__super__.render.apply(this, arguments);
        },

        finish: function() {
            this.articles.appendTo(this.$(".chapter-articles"));

            this.$("> .chapter-title").css("paddingLeft", (4+(this.model.get("level").length)*8)+"px");
            this.$("> .chapter-title").click(this.open.bind(this));

            return ArticleItem.__super__.finish.apply(this, arguments);
        },

        templateContext: function() {
            return {
                'article': this.model
            };
        },

        open: function(e) {
            e.preventDefault();
            e.stopPropagation();

            this.editor.openArticle(this.model);
        },

        changeTitle: function() {
            dialogs.prompt("Change Title", "", this.model.get("title"))
            .then(function(title) {
                this.model.set("title", title);
                this.summary.save();
            }.bind(this));
        },

        addChapter: function(e) {
            var that = this;

            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            dialogs.prompt("Add New Article", "Enter a title for the new article", "Article")
            .then(function(title) {
                var dir = dirname(that.model.get('path')),
                    _title = normalizePath(title),
                    article = {
                        title: title,
                        path: dir+"/"+_title
                    };
                that.model.articles.add(article);
                that.summary.save();
            });
        },

        removeChapter: function() {
            var that = this;

            var removeArticle = function () {
                var path = that.model.get("path"),
                names = path.split("/");
                // to do change to path.filename
                if (names[names.length - 1] === "README.md"){
                    return that.editor.model.rmdir(dirname(path));
                }
                return that.editor.model.unlink(path);
            };
            var hasChildren = that.model.articles.models.length !== 0;
            dialogs.confirm("Remove entry", "Do you really want to remove this" +
                (hasChildren ? " and all the sub-articles?":"?") )
                .then(function() {
                    that.collection.remove(that.model);
                    that.summary.save();
                    removeArticle();
                });
        }

    });

    var ArticlesView = hr.List.extend({
        className: "articles",
        Collection: Articles,
        Item: ArticleItem,

        initialize: function() {
            var that = this;
            ArticlesView.__super__.initialize.apply(this, arguments);

            this.summary = this.parent;
        }
    });

    return ArticlesView;
});