class Comic {
    constructor({
        id,
        title,
        subtitle,
        subTitle,
        cover,
        tags,
        description,
        maxPage,
        language,
        favoriteId,
        stars
    }) {
        this.id = id;
        this.title = title;
        this.subtitle = subtitle ?? subTitle;
        this.subTitle = subTitle ?? subtitle;
        this.cover = cover;
        this.tags = tags || [];
        this.description = description;
        this.maxPage = maxPage;
        this.language = language;
        this.favoriteId = favoriteId;
        this.stars = stars;
    }
}

class ComicDetails {
    constructor({
        title,
        subtitle,
        subTitle,
        cover,
        description,
        tags,
        chapters,
        isFavorite,
        subId,
        thumbnails,
        recommend,
        related,
        commentCount,
        likesCount,
        isLiked,
        uploader,
        updateTime,
        uploadTime,
        url,
        stars,
        maxPage,
        comments
    }) {
        this.title = title;
        this.subtitle = subtitle ?? subTitle;
        this.subTitle = subTitle ?? subtitle;
        this.cover = cover;
        this.description = description;
        this.tags = tags;
        this.chapters = chapters;
        this.isFavorite = isFavorite;
        this.subId = subId;
        this.thumbnails = thumbnails;
        this.recommend = recommend ?? related;
        this.related = related ?? recommend;
        this.commentCount = commentCount;
        this.likesCount = likesCount;
        this.isLiked = isLiked;
        this.uploader = uploader;
        this.updateTime = updateTime;
        this.uploadTime = uploadTime;
        this.url = url;
        this.stars = stars;
        this.maxPage = maxPage;
        this.comments = comments;
    }
}

class Comment {
    constructor({
        userName,
        avatar,
        content,
        time,
        replyCount,
        id,
        isLiked,
        score,
        voteStatus
    }) {
        this.userName = userName;
        this.avatar = avatar;
        this.content = content;
        this.time = time;
        this.replyCount = replyCount;
        this.id = id;
        this.isLiked = isLiked;
        this.score = score;
        this.voteStatus = voteStatus;
    }
}

class ComicSource {
    constructor() {
        this.name = '';
        this.key = '';
        this.version = '1.0.0';
        this.minAppVersion = '1.0.0';
        this.url = '';
        this.baseUrl = '';
        this.account = null;
        this.explore = [];
        this.category = null;
        this.categoryComics = null;
        this.search = null;
        this.favorites = null;
        this.comic = null;
        this.translation = {};
    }
}

module.exports = {
    Comic,
    ComicDetails,
    Comment,
    ComicSource
};
